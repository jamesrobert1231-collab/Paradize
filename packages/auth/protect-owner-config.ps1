$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
try {
    if ($env:OS -ne 'Windows_NT') { throw 'Windows required' }
    # Bound input before parsing or allocating a complete request. No record/secret
    # is supplied in arguments: only the operation and local directory arrive here.
    $inputBuffer = New-Object char[] 4097
    $inputLength = 0
    while ($inputLength -lt $inputBuffer.Length) {
        $count = [Console]::In.Read($inputBuffer, $inputLength, $inputBuffer.Length - $inputLength)
        if ($count -eq 0) { break }
        $inputLength += $count
    }
    if ($inputLength -eq 0 -or $inputLength -gt 4096) { throw 'Invalid request' }
    $request = ConvertFrom-Json -InputObject (-join $inputBuffer[0..($inputLength - 1)])
    if ($null -eq $request -or @($request.PSObject.Properties).Count -ne 2 -or
        $request.operation -notin @('create', 'load') -or $request.directory -isnot [string]) { throw 'Invalid request' }

    Add-Type -AssemblyName System.Security
    Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

public static class ParadizeOwnerConfig {
    const uint ReadControl = 0x00020000, ReadAttributes = 0x80;
    const uint Reparse = 0x400, DirectoryAttribute = 0x10;
    const string FileName = "owner-config.dpapi", PendingName = "owner-config.pending";
    const int MaxCipherBytes = 8192;
    static readonly byte[] Entropy = Encoding.UTF8.GetBytes("PARADIZE.owner-config.v1");
    static readonly string Id = "[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}";
    static readonly Regex Record = new Regex("\\A\\{\"version\":1,\"ownerId\":\"(" + Id + ")\",\"installationId\":\"(" + Id + ")\",\"nativeDeviceId\":\"(" + Id + ")\"\\}\\z", RegexOptions.CultureInvariant);
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

    [StructLayout(LayoutKind.Sequential)] struct Attributes {
        public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }
    [StructLayout(LayoutKind.Sequential)] struct FileInfo {
        public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Creation;
        public System.Runtime.InteropServices.ComTypes.FILETIME Access;
        public System.Runtime.InteropServices.ComTypes.FILETIME Write;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateDirectoryW(string path, ref Attributes security);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFileW(string path, uint access, uint sharing, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true, EntryPoint="CreateFileW")]
    static extern SafeFileHandle CreateProtectedFile(string path, uint access, uint sharing, ref Attributes security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo info);
    [DllImport("advapi32.dll", SetLastError=true)]
    static extern bool GetKernelObjectSecurity(SafeFileHandle handle, uint requested, byte[] descriptor, uint length, out uint needed);

    static void Require(bool value) { if (!value) throw new InvalidOperationException("Owner configuration unavailable"); }
    static FileInfo Information(SafeFileHandle handle) {
        FileInfo info = new FileInfo(); Require(!handle.IsInvalid && GetFileInformationByHandle(handle, out info)); return info;
    }
    static byte[] Descriptor(SecurityIdentifier owner, bool directory) {
        FileSystemSecurity acl = directory ? (FileSystemSecurity)new DirectorySecurity() : new FileSecurity();
        acl.SetOwner(owner); acl.SetAccessRuleProtection(true, false);
        InheritanceFlags inheritance = directory ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit : InheritanceFlags.None;
        foreach (SecurityIdentifier sid in new [] { owner, new SecurityIdentifier("S-1-5-18") })
            acl.AddAccessRule(new FileSystemAccessRule(sid, FileSystemRights.FullControl, inheritance, PropagationFlags.None, AccessControlType.Allow));
        return acl.GetSecurityDescriptorBinaryForm();
    }
    static void PrivateAcl(SafeFileHandle handle, SecurityIdentifier owner, bool directory) {
        uint needed;
        GetKernelObjectSecurity(handle, 5, null, 0, out needed); // OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION
        Require(needed > 0 && needed <= 16384);
        byte[] bytes = new byte[needed];
        Require(GetKernelObjectSecurity(handle, 5, bytes, needed, out needed));
        RawSecurityDescriptor descriptor = new RawSecurityDescriptor(bytes, 0);
        Require(owner.Equals(descriptor.Owner) && (descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0);
        RawAcl acl = descriptor.DiscretionaryAcl;
        Require(acl != null && acl.Count == 2);
        HashSet<string> granted = new HashSet<string>();
        foreach (GenericAce entry in acl) {
            CommonAce ace = entry as CommonAce;
            Require(ace != null && !ace.IsCallback && ace.AceQualifier == AceQualifier.AccessAllowed &&
                ace.AccessMask == (int)FileSystemRights.FullControl &&
                ace.AceFlags == (directory ? AceFlags.ContainerInherit | AceFlags.ObjectInherit : AceFlags.None));
            string sid = ace.SecurityIdentifier.Value;
            Require((sid == owner.Value || sid == "S-1-5-18") && granted.Add(sid));
        }
    }
    static bool MakeDirectory(string path, SecurityIdentifier owner) {
        byte[] bytes = Descriptor(owner, true);
        GCHandle pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        try {
            Attributes attrs = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Descriptor = pinned.AddrOfPinnedObject() };
            if (CreateDirectoryW(path, ref attrs)) return true;
            int error = Marshal.GetLastWin32Error();
            Require(error == 183); // Existing leaf is handled as refusal, never repaired.
            return false;
        } finally { pinned.Free(); }
    }
    static SafeFileHandle OpenDirectory(string path) {
        // No DELETE share: the validated ancestors cannot be renamed away while
        // this operation resolves descendants. OPEN_REPARSE_POINT checks the link itself.
        SafeFileHandle handle = CreateFileW(path, ReadControl | ReadAttributes, 3, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        try {
            FileInfo info = Information(handle);
            Require((info.Attributes & (Reparse | DirectoryAttribute)) == DirectoryAttribute);
            return handle;
        } catch { handle.Dispose(); throw; }
    }
    static string CheckedPath(string input) {
        Require(input != null && input.Length <= 220 && Regex.IsMatch(input, "\\A[A-Za-z]:\\\\"));
        Require(input.Length > 3 && !input.EndsWith("\\", StringComparison.Ordinal) && input.IndexOf('/') < 0);
        foreach (string part in input.Substring(3).Split('\\')) {
            Require(part.Length > 0 && part != "." && part != ".." && !part.EndsWith(".", StringComparison.Ordinal) &&
                !part.EndsWith(" ", StringComparison.Ordinal) && part.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 &&
                !Regex.IsMatch(part, "\\A(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\\.|$)", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant));
        }
        string full = Path.GetFullPath(input);
        Require(String.Equals(full, input, StringComparison.OrdinalIgnoreCase));
        Require(new DriveInfo(full.Substring(0, 3)).DriveType == DriveType.Fixed);
        return full;
    }
    static void OnlyFinalFile(string path) {
        int count = 0;
        foreach (string entry in System.IO.Directory.EnumerateFileSystemEntries(path)) {
            Require(++count == 1 && String.Equals(Path.GetFileName(entry), FileName, StringComparison.Ordinal));
        }
        Require(count == 1);
    }
    static string ValidateRecord(string json) {
        Match match = Record.Match(json);
        Require(match.Success && match.Groups[1].Value != match.Groups[2].Value &&
            match.Groups[1].Value != match.Groups[3].Value && match.Groups[2].Value != match.Groups[3].Value);
        return json;
    }
    static string Read(string path, SecurityIdentifier owner) {
        OnlyFinalFile(path);
        using (SafeFileHandle handle = CreateFileW(Path.Combine(path, FileName), 0x80000000 | ReadControl, 0,
                    IntPtr.Zero, 3, 0x00200000, IntPtr.Zero)) {
            FileInfo info = Information(handle);
            Require((info.Attributes & (Reparse | DirectoryAttribute)) == 0 && info.Links == 1 &&
                info.SizeHigh == 0 && info.SizeLow > 0 && info.SizeLow <= MaxCipherBytes);
            PrivateAcl(handle, owner, false);
            byte[] encrypted = new byte[info.SizeLow];
            using (FileStream stream = new FileStream(handle, FileAccess.Read)) {
                int offset = 0;
                while (offset < encrypted.Length) {
                    int count = stream.Read(encrypted, offset, encrypted.Length - offset);
                    Require(count > 0); offset += count;
                }
                Require(stream.ReadByte() == -1);
                byte[] plain = ProtectedData.Unprotect(encrypted, Entropy, DataProtectionScope.CurrentUser);
                try { Require(plain.Length <= 1024); return ValidateRecord(Utf8.GetString(plain)); }
                finally { Array.Clear(plain, 0, plain.Length); }
            }
        }
    }
    static void Write(string path, SecurityIdentifier owner, string json) {
        byte[] plain = Utf8.GetBytes(json), encrypted;
        try { encrypted = ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser); }
        finally { Array.Clear(plain, 0, plain.Length); }
        Require(encrypted.Length <= MaxCipherBytes);
        byte[] bytes = Descriptor(owner, false);
        GCHandle pinned = GCHandle.Alloc(bytes, GCHandleType.Pinned);
        string pending = Path.Combine(path, PendingName);
        try {
            Attributes attrs = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Descriptor = pinned.AddrOfPinnedObject() };
            using (SafeFileHandle handle = CreateProtectedFile(pending, 0xC0000000 | ReadControl, 0, ref attrs, 1, 0x80200000, IntPtr.Zero)) {
                FileInfo info = Information(handle);
                Require(info.Links == 1 && (info.Attributes & (Reparse | DirectoryAttribute)) == 0);
                PrivateAcl(handle, owner, false);
                using (FileStream stream = new FileStream(handle, FileAccess.ReadWrite)) {
                    stream.Write(encrypted, 0, encrypted.Length); stream.Flush(true);
                }
            }
        } finally { pinned.Free(); }
        // No overwrite. A killed/failed creator leaves an unmistakable reserved
        // directory or pending file; subsequent creation does not mint new IDs.
        File.Move(pending, Path.Combine(path, FileName));
    }
    public static string Run(string operation, string input) {
        Require(operation == "create" || operation == "load");
        string path = CheckedPath(input);
        SecurityIdentifier owner = WindowsIdentity.GetCurrent().User;
        Require(owner != null && owner.Value != "S-1-5-18" && owner.Value != "S-1-5-7");
        List<SafeFileHandle> handles = new List<SafeFileHandle>();
        try {
            string current = path.Substring(0, 3);
            handles.Add(OpenDirectory(current));
            string[] parts = path.Substring(3).Split('\\');
            for (int i = 0; i < parts.Length; i++) {
                current = Path.Combine(current, parts[i]);
                bool leaf = i == parts.Length - 1;
                if (operation == "create") {
                    bool made = MakeDirectory(current, owner);
                    Require(!leaf || made);
                }
                SafeFileHandle handle = OpenDirectory(current); handles.Add(handle);
                if (leaf) PrivateAcl(handle, owner, true);
            }
            if (operation == "create") {
                string json = "{\"version\":1,\"ownerId\":\"" + Guid.NewGuid().ToString("D") +
                    "\",\"installationId\":\"" + Guid.NewGuid().ToString("D") + "\",\"nativeDeviceId\":\"" + Guid.NewGuid().ToString("D") + "\"}";
                Write(path, owner, ValidateRecord(json));
            }
            return Read(path, owner);
        } finally { for (int i = handles.Count - 1; i >= 0; i--) handles[i].Dispose(); }
    }
}
'@ -ReferencedAssemblies System.Security, System.Core
    [Console]::Out.WriteLine([ParadizeOwnerConfig]::Run($request.operation, $request.directory))
    exit 0
} catch {
    [Console]::Error.WriteLine('OWNER_CONFIG_UNAVAILABLE')
    exit 1
}

using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Paradize
{
    /// <summary>Explicit owner downloads. No source bytes reach disk before their hash is verified.</summary>
    public static class SourceCopyStore
    {
        public const int MaximumBytes = 10 * 1024 * 1024;

        public static bool IsDigest(string value)
        {
            if (value == null || value.Length != 64) return false;
            foreach (char c in value) if (!(c >= '0' && c <= '9') && !(c >= 'a' && c <= 'f')) return false;
            return true;
        }

        public static bool Matches(byte[] bytes, string expected)
        {
            if (bytes == null || bytes.Length < 1 || bytes.Length > MaximumBytes || !IsDigest(expected)) return false;
            using (var sha = SHA256.Create())
                return string.Equals(BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant(), expected, StringComparison.Ordinal);
        }

        public static string CopyName(string id, string source)
        {
            if (!IsDigest(id)) throw new InvalidDataException("Source identifier is invalid.");
            // Treat both separators as separators, even when provenance came from another operating system.
            string leaf = (source ?? "").Replace('\\', '/');
            leaf = leaf.Substring(leaf.LastIndexOf('/') + 1);
            var safe = new StringBuilder();
            foreach (char c in leaf)
            {
                if (safe.Length == 80) break;
                safe.Append(char.IsLetterOrDigit(c) && c <= 127 || c == '.' || c == '-' || c == '_' || c == ' ' ? c : '_');
            }
            string name = safe.ToString().Trim(' ', '.');
            return id + "-" + Guid.NewGuid().ToString("N") + "-" + (name.Length == 0 ? "source.original" : name);
        }

        public static string ProtectedDirectory(string tokenFile)
        {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT || string.IsNullOrEmpty(tokenFile) || !Path.IsPathRooted(tokenFile))
                throw new InvalidOperationException("Use the trusted Windows launcher to save source copies.");
            string path = Path.GetFullPath(tokenFile);
            if (path.StartsWith("\\\\", StringComparison.Ordinal) || Path.GetFileName(path) != "token")
                throw new InvalidOperationException("Source copy storage is unavailable.");
            var token = new FileInfo(path);
            if (!token.Exists || (token.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Protected owner storage is unavailable.");
            var runtime = token.Directory;
            CheckAncestors(runtime);
            CheckAccess(token.FullName, true);
            CheckAccess(runtime.FullName, true);
            var copies = new DirectoryInfo(Path.Combine(runtime.FullName, "SourceCopies"));
            if (!copies.Exists) copies.Create();
            CheckAncestors(copies);
            CheckAccess(copies.FullName, false);
            return copies.FullName;
        }

        static void CheckAncestors(DirectoryInfo directory)
        {
            for (var current = directory; current != null; current = current.Parent)
            {
                current.Refresh();
                if (!current.Exists || (current.Attributes & FileAttributes.ReparsePoint) != 0)
                    throw new InvalidOperationException("Source copy storage cannot contain linked directories.");
            }
        }

        static void CheckAccess(string path, bool requireProtected)
        {
            // Unity's Mono drops the protected-DACL flag on managed ACL reads.
            // Read Windows' authoritative owner and DACL without requiring editor-only ACL assemblies.
            IntPtr owner,group,dacl,sacl,descriptor=IntPtr.Zero;
            try
            {
                if(GetNamedSecurityInfo(path,1,5,out owner,out group,out dacl,out sacl,out descriptor)!=0 || descriptor==IntPtr.Zero)
                    throw new InvalidOperationException("Owner storage permissions are unavailable.");
                uint length=GetSecurityDescriptorLength(descriptor);
                ushort control;uint revision;
                string currentOwner=CurrentOwnerSid();
                if(length<20 || length>65536 || owner==IntPtr.Zero || dacl==IntPtr.Zero ||
                    !GetSecurityDescriptorControl(descriptor,out control,out revision) || (control&0x4)==0 ||
                    requireProtected && (control&0x1000)==0 || SidText(owner)!=currentOwner)
                    throw new InvalidOperationException("Owner storage protection could not be confirmed.");
                AclSize information;
                if(!GetAclInformation(dacl,out information,(uint)Marshal.SizeOf(typeof(AclSize)),2) ||
                    information.BytesInUse<8 || information.BytesInUse>65536 || information.Count>4096)
                    throw new InvalidOperationException("Owner storage permissions are invalid.");
                bool ownerAllowed=false;
                for(uint i=0;i<information.Count;i++)
                {
                    IntPtr ace;
                    if(!GetAce(dacl,i,out ace))throw new InvalidOperationException("Owner storage permissions are invalid.");
                    long offset=ace.ToInt64()-dacl.ToInt64();
                    if(offset<8 || offset>information.BytesInUse-4)throw new InvalidOperationException("Owner storage permissions are invalid.");
                    int size=(ushort)Marshal.ReadInt16(ace,2);
                    if(size<16 || offset+size>information.BytesInUse)throw new InvalidOperationException("Owner storage permissions are invalid.");
                    byte kind=Marshal.ReadByte(ace),flags=Marshal.ReadByte(ace,1);
                    // Only unconditional file allow/deny entries are supported. Unknown or conditional grants fail closed.
                    if(kind!=0 && kind!=1)throw new InvalidOperationException("Owner storage permissions could not be validated.");
                    IntPtr sid=IntPtr.Add(ace,8);
                    // A SID has an eight-byte header followed by at most fifteen DWORD subauthorities.
                    // Validate that complete extent before asking native helpers to inspect the SID.
                    int subauthorities=Marshal.ReadByte(sid,1),sidBytes=8+4*subauthorities;
                    if(subauthorities>15 || sidBytes>size-8)throw new InvalidOperationException("Owner storage permissions are invalid.");
                    if(!IsValidSid(sid) || GetLengthSid(sid)>size-8)throw new InvalidOperationException("Owner storage permissions are invalid.");
                    if(kind==1)continue;
                    string grant=SidText(sid);
                    if(grant!=currentOwner && grant!="S-1-5-18")throw new InvalidOperationException("Owner storage has unexpected access grants.");
                    if(grant==currentOwner && (flags&0x8)==0)ownerAllowed=true;
                }
                if(!ownerAllowed)throw new InvalidOperationException("Owner storage access is unavailable.");
            }
            finally{if(descriptor!=IntPtr.Zero)LocalFree(descriptor);}
        }

        // Unity's Mono does not implement WindowsIdentity.User. Query this process's
        // read-only Windows token instead; no token value or handle leaves this method.
        static string CurrentOwnerSid()
        {
            IntPtr handle=IntPtr.Zero, information=IntPtr.Zero;
            try
            {
                if(!OpenProcessToken(GetCurrentProcess(),8,out handle))throw new InvalidOperationException("Owner identity is unavailable.");
                int needed;
                GetTokenInformation(handle,1,IntPtr.Zero,0,out needed);
                if(needed<=0 || needed>65536)throw new InvalidOperationException("Owner identity is unavailable.");
                information=Marshal.AllocHGlobal(needed);
                if(!GetTokenInformation(handle,1,information,needed,out needed))
                    throw new InvalidOperationException("Owner identity is unavailable.");
                return SidText(Marshal.ReadIntPtr(information));
            }
            finally
            {
                if(information!=IntPtr.Zero)Marshal.FreeHGlobal(information);
                if(handle!=IntPtr.Zero)CloseHandle(handle);
            }
        }
        static string SidText(IntPtr sid)
        {
            IntPtr text=IntPtr.Zero;
            try
            {
                if(sid==IntPtr.Zero || !IsValidSid(sid) || GetLengthSid(sid)>68 || !ConvertSidToStringSid(sid,out text))
                    throw new InvalidOperationException("Owner identity is unavailable.");
                return Marshal.PtrToStringUni(text);
            }
            finally{if(text!=IntPtr.Zero)LocalFree(text);}
        }
        [StructLayout(LayoutKind.Sequential)]struct AclSize {public uint Count,BytesInUse,BytesFree;}
        [DllImport("kernel32.dll")]static extern IntPtr GetCurrentProcess();
        [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
        [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr token,int type,IntPtr information,int length,out int returnedLength);
        [DllImport("advapi32.dll",EntryPoint="ConvertSidToStringSidW",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool ConvertSidToStringSid(IntPtr sid,out IntPtr value);
        [DllImport("advapi32.dll",EntryPoint="GetNamedSecurityInfoW",CharSet=CharSet.Unicode)]static extern uint GetNamedSecurityInfo(string path,int objectType,uint securityInfo,out IntPtr owner,out IntPtr group,out IntPtr dacl,out IntPtr sacl,out IntPtr descriptor);
        [DllImport("advapi32.dll")]static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("advapi32.dll")]static extern bool GetSecurityDescriptorControl(IntPtr descriptor,out ushort control,out uint revision);
        [DllImport("advapi32.dll")]static extern bool GetAclInformation(IntPtr acl,out AclSize information,uint length,int kind);
        [DllImport("advapi32.dll")]static extern bool GetAce(IntPtr acl,uint index,out IntPtr ace);
        [DllImport("advapi32.dll")]static extern bool IsValidSid(IntPtr sid);
        [DllImport("advapi32.dll")]static extern uint GetLengthSid(IntPtr sid);
        [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr memory);
        [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);

        public static string Save(string tokenFile, string id, string source, string expectedSha256, byte[] bytes, Func<bool> cancelled)
        {
            if (!IsDigest(id) || !Matches(bytes, expectedSha256)) throw new InvalidDataException("Source copy fingerprint did not match.");
            if (cancelled == null) throw new ArgumentNullException("cancelled");
            if (cancelled()) throw new OperationCanceledException();
            string directory = ProtectedDirectory(tokenFile);
            string destination = Path.Combine(directory, CopyName(id, source));
            string temporary = Path.Combine(directory, ".pending-" + Guid.NewGuid().ToString("N"));
            bool created = false;
            try
            {
                using (var output = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    created = true;
                    // A protected folder need not contain inheritable rules. Verify the actual
                    // newly created file before any source bytes can reach it.
                    CheckAccess(temporary,false);
                    for (int offset = 0; offset < bytes.Length; offset += 65536)
                    {
                        if (cancelled()) throw new OperationCanceledException();
                        output.Write(bytes, offset, Math.Min(65536, bytes.Length - offset));
                    }
                    output.Flush(true);
                }
                // Re-check the trusted destination immediately before exclusive publication.
                if (cancelled()) throw new OperationCanceledException();
                if (ProtectedDirectory(tokenFile) != directory) throw new InvalidOperationException("Source copy storage changed.");
                CheckAccess(temporary,false);
                File.Move(temporary, destination);
                return destination;
            }
            finally
            {
                // Only this invocation's newly created temporary file is removed.
                if (created && File.Exists(temporary)) File.Delete(temporary);
            }
        }
    }
}

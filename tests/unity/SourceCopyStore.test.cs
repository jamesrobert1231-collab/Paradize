using System;
using System.IO;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Paradize;

static class SourceCopyStoreTests
{
    static int passed;
    static string root, token, ownerSid, id = new string('a',64);
    static byte[] bytes = System.Text.Encoding.UTF8.GetBytes("Preserved synthetic source\r\n\0Original bytes, not a model response.");
    static string Digest(byte[] value)
    {using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(value)).Replace("-","").ToLowerInvariant();}
    static void Assert(bool value,string message){if(!value)throw new Exception(message);}
    static void Test(string label,Action body){body();passed++;Console.WriteLine("PASS "+label);}
    static void Reject(Action action)
    {bool rejected=false;try{action();}catch{rejected=true;}Assert(rejected,"Expected rejection");}
    static void Protect(FileSystemSecurity acl, bool directory)
    {
        var owner=new SecurityIdentifier(ownerSid);
        acl.SetAccessRuleProtection(true,false);
        foreach(FileSystemAccessRule rule in acl.GetAccessRules(true,true,typeof(SecurityIdentifier)))acl.RemoveAccessRuleSpecific(rule);
        foreach(var sid in new[]{owner,new SecurityIdentifier("S-1-5-18")})
            acl.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,
                directory?InheritanceFlags.ContainerInherit|InheritanceFlags.ObjectInherit:InheritanceFlags.None,
                PropagationFlags.None,AccessControlType.Allow));
    }
    static int Files(){string path=Path.Combine(root,"SourceCopies");return Directory.Exists(path)?Directory.GetFiles(path).Length:0;}
    static string Save(byte[] value,Func<bool> cancelled)
    {return SourceCopyStore.Save(token,id,@"C:\private\synthetic.txt",Digest(value),value,cancelled);}
    public static int Main(string[] args)
    {
        root=Path.GetFullPath(args[0]);
        ownerSid=args[1];
        if(Directory.Exists(root))throw new Exception("Fixture must be new");
        Directory.CreateDirectory(root);
        var directory=new DirectoryInfo(root);var acl=directory.GetAccessControl();Protect(acl,true);directory.SetAccessControl(acl);
        token=Path.Combine(root,"token");File.WriteAllText(token,"synthetic-test-marker");
        var file=new FileInfo(token);var tokenAcl=file.GetAccessControl();Protect(tokenAcl,false);file.SetAccessControl(tokenAcl);
        try
        {
            Test("exact byte fingerprint and strict lowercase identity",()=>{
                Assert(SourceCopyStore.Matches(bytes,Digest(bytes)),"Known fingerprint failed");
                Assert(!SourceCopyStore.Matches(bytes,new string('0',64)),"Wrong fingerprint accepted");
                Assert(!SourceCopyStore.IsDigest(new string('A',64)) && !SourceCopyStore.IsDigest("../token"),"Invalid identity accepted");
            });
            Test("Windows-safe record-prefixed filenames",()=>{
                string name=SourceCopyStore.CopyName(id,@"C:\original\..\CON:unsafe?.txt");
                Assert(name.StartsWith(id+"-") && name.EndsWith("CON_unsafe_.txt"),"Unsafe basename");
                Assert(name.IndexOfAny(Path.GetInvalidFileNameChars())<0 && name.Length<200,"Invalid output name");
                Assert(SourceCopyStore.CopyName(id,"/").EndsWith("source.original"),"Fallback filename missing");
            });
            Test("exact source copy in owner protected directory",()=>{
                string destination=Save(bytes,()=>false);
                Assert(destination.StartsWith(Path.Combine(root,"SourceCopies")+Path.DirectorySeparatorChar),"Escaped owner storage");
                Assert(Digest(File.ReadAllBytes(destination))==Digest(bytes),"Output changed");
                var access=new FileInfo(destination).GetAccessControl();
                foreach(FileSystemAccessRule rule in access.GetAccessRules(true,true,typeof(SecurityIdentifier)))
                    if(rule.AccessControlType==AccessControlType.Allow)Assert(rule.IdentityReference.Value==ownerSid || rule.IdentityReference.Value=="S-1-5-18","Unexpected output access");
                Assert(File.ReadAllText(token)=="synthetic-test-marker","Token fixture was modified");
            });
            Test("repeated saves never overwrite an earlier copy",()=>{
                int before=Files();string first=Save(bytes,()=>false);string second=Save(bytes,()=>false);
                Assert(first!=second && Files()==before+2,"Copies overwritten");
                Assert(Digest(File.ReadAllBytes(first))==Digest(bytes),"Earlier copy changed");
            });
            Test("mismatch, empty and oversized inputs publish nothing",()=>{
                int before=Files();
                Reject(()=>SourceCopyStore.Save(token,id,"x",new string('0',64),bytes,()=>false));
                Reject(()=>Save(new byte[0],()=>false));
                Reject(()=>Save(new byte[SourceCopyStore.MaximumBytes+1],()=>false));
                Assert(Files()==before,"Rejected content reached storage");
            });
            Test("cancellation before write leaves no output",()=>{
                int before=Files();Reject(()=>Save(bytes,()=>true));Assert(Files()==before,"Cancelled copy published");
            });
            Test("cancellation during multi-chunk write removes its partial file",()=>{
                int before=Files(),calls=0;
                Reject(()=>Save(new byte[200000],()=>++calls==3));
                Assert(calls==3 && Files()==before,"Partial write survived cancellation");
            });
            Test("cancellation immediately before publication leaves no output",()=>{
                int before=Files(),calls=0;
                Reject(()=>Save(bytes,()=>++calls==3));
                Assert(calls==3 && Files()==before,"Verified but cancelled output published");
            });
            Test("untrusted token path rejected",()=>{
                int before=Files();Reject(()=>SourceCopyStore.Save(Path.Combine(root,"absent"),id,"x",Digest(bytes),bytes,()=>false));
                Reject(()=>SourceCopyStore.Save("relative/token",id,"x",Digest(bytes),bytes,()=>false));Assert(Files()==before,"Unsafe path accepted");
            });
            Test("unexpected access to copy directory rejects write",()=>{
                var target=new DirectoryInfo(Path.Combine(root,"SourceCopies"));var original=target.GetAccessControl();var broad=target.GetAccessControl();
                broad.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-1-0"),FileSystemRights.Read,AccessControlType.Allow));target.SetAccessControl(broad);
                int before=Files();try{Reject(()=>Save(bytes,()=>false));Assert(Files()==before,"Broad destination accepted");}finally{target.SetAccessControl(original);}
            });
            Test("unexpected access to launcher token rejects write",()=>{
                var target=new FileInfo(token);var original=target.GetAccessControl();var broad=target.GetAccessControl();
                broad.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier("S-1-1-0"),FileSystemRights.Read,AccessControlType.Allow));target.SetAccessControl(broad);
                int before=Files();try{Reject(()=>Save(bytes,()=>false));Assert(Files()==before,"Broad token accepted");}finally{target.SetAccessControl(original);}
            });
            Test("non-inheriting folder rules cannot produce a broadly accessible copy",()=>{
                var target=new DirectoryInfo(Path.Combine(root,"SourceCopies"));var original=target.GetAccessControl();
                var nonInheriting=target.GetAccessControl();nonInheriting.SetAccessRuleProtection(true,false);
                foreach(FileSystemAccessRule rule in nonInheriting.GetAccessRules(true,true,typeof(SecurityIdentifier)))nonInheriting.RemoveAccessRuleSpecific(rule);
                foreach(var sid in new[]{new SecurityIdentifier(ownerSid),new SecurityIdentifier("S-1-5-18")})
                    nonInheriting.AddAccessRule(new FileSystemAccessRule(sid,FileSystemRights.FullControl,InheritanceFlags.None,PropagationFlags.None,AccessControlType.Allow));
                target.SetAccessControl(nonInheriting);
                int before=Files();string saved=null;
                try
                {
                    try{saved=Save(bytes,()=>false);}catch(InvalidOperationException){}
                    if(saved==null){Assert(Files()==before,"Unprotected partial copy was retained");}
                    else
                    {
                        Assert(Digest(File.ReadAllBytes(saved))==Digest(bytes),"Saved bytes changed");
                        foreach(FileSystemAccessRule rule in new FileInfo(saved).GetAccessControl().GetAccessRules(true,true,typeof(SecurityIdentifier)))
                            if(rule.AccessControlType==AccessControlType.Allow)Assert(rule.IdentityReference.Value==ownerSid || rule.IdentityReference.Value=="S-1-5-18","Non-inheriting folder created a broadly accessible source copy");
                    }
                }
                finally{target.SetAccessControl(original);}
            });
            Console.WriteLine("SOURCE_COPY_TESTS_PASSED="+passed);return 0;
        }
        catch(Exception error){Console.Error.WriteLine(error);return 1;}
    }
}

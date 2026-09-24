using System;
using Paradize;
class SunnyBridgeContractTests
{
    static int checks;
    static void Check(bool actual, bool expected, string label)
    { if(actual!=expected)throw new Exception(label); checks++; }
    static void Main()
    {
        Check(SunnyBridgeContract.Accepts("paradize-sunny-local",2,true,"ollama",false),true,"current bridge");
        Check(SunnyBridgeContract.Accepts(null,0,false,"ollama",false),false,"older bridge defaults");
        foreach(var version in new[]{0,1,3,-1,int.MaxValue})
            Check(SunnyBridgeContract.Accepts("paradize-sunny-local",version,true,"ollama",false),false,"wrong version");
        foreach(var service in new[]{null,"","other","PARADIZE-SUNNY-LOCAL"})
            Check(SunnyBridgeContract.Accepts(service,2,true,"ollama",false),false,"wrong service");
        foreach(var provider in new[]{null,"","cloud","OLLAMA"})
            Check(SunnyBridgeContract.Accepts("paradize-sunny-local",2,true,provider,false),false,"wrong provider");
        Check(SunnyBridgeContract.Accepts("paradize-sunny-local",2,false,"ollama",false),false,"policy missing");
        Check(SunnyBridgeContract.Accepts("paradize-sunny-local",2,true,"ollama",true),false,"paid enabled");
        Check(SunnyBridgeContract.ChatReady("ready","qwen2.5:3b"),true,"local model ready");
        Check(SunnyBridgeContract.ChatReady("ready","qwen3.5:4b"),true,"alternate local model ready");
        foreach(var status in new[]{null,"","stopped","model-unavailable","ollama-unavailable","local-only-unconfirmed","unexpected"})
            Check(SunnyBridgeContract.ChatReady(status,"qwen2.5:3b"),false,"unavailable status");
        foreach(var model in new[]{null,"","cloud-model","qwen2.5:3b-cloud"})
            Check(SunnyBridgeContract.ChatReady("ready",model),false,"unqualified model");
        Check(SunnyBridgeContract.HealthMessage("local-only-unconfirmed",null).Contains("cloud access is disabled"),true,"policy explanation");
        Check(SunnyBridgeContract.HealthMessage("model-unavailable",null).Contains("local model"),true,"model explanation");
        Check(SunnyBridgeContract.HealthMessage("ollama-unavailable",null).Contains("local AI service"),true,"service explanation");
        Check(SunnyBridgeContract.HealthMessage("stopped",null).Contains("resume"),true,"explicit resume");
        Check(SunnyBridgeContract.HealthMessage("unexpected",null).Contains("not recognized"),true,"unknown state");
        Check(SunnyBridgeContract.HealthMessage("ready","<untrusted>").Contains("<untrusted>"),false,"unknown model not displayed");
        string summary;
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",3,2,"on-access",false,out summary),true,"retained knowledge counts");
        Check(summary.Contains("3 retained records") && summary.Contains("2 sources"),true,"counts presented separately");
        Check(summary.Contains("checked when opened"),true,"does not claim original verification");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","no-records",0,0,"on-access",false,out summary),true,"explicit empty index");
        Check(summary.Contains("does not mean"),true,"empty import is not empty history");
        Check(SunnyBridgeContract.TryKnowledgeSummary("unavailable","no-records",0,0,"on-access",false,out summary),false,"unavailable is not empty");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",0,0,"on-access",false,out summary),false,"inconsistent ready count");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","no-records",1,1,"on-access",false,out summary),false,"inconsistent empty state");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",2,3,"on-access",false,out summary),false,"sources exceed records");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",10001,1,"on-access",false,out summary),false,"record bound");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",1,0,"on-access",false,out summary),false,"missing source count");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",1,1,null,false,out summary),false,"missing verification scope");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","index-ready",1,1,"on-access",true,out summary),false,"historical records are not authority");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","no-records",-1,-1,"on-access",false,out summary),false,"omitted count sentinels");
        Check(SunnyBridgeContract.TryKnowledgeSummary("complete","no-records",0,0,"on-access",true,out summary),false,"omitted authority sentinel");
        Console.WriteLine(checks+" Unity bridge contract checks passed");
    }
}

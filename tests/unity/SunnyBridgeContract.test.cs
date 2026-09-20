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
        Console.WriteLine(checks+" Unity bridge contract checks passed");
    }
}

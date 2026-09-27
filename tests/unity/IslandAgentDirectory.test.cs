using System;
using System.Collections.Generic;
using Paradize;
using UnityEngine;

// Deliberately narrow execution boundaries for production Start/Visit/SelectAgent.
// Coroutines, rendering, input, Unity serialization and native runtime are not exercised.
namespace UnityEngine
{
    public struct Vector3
    {
        public float x,y,z;
        public Vector3(float x,float y,float z){this.x=x;this.y=y;this.z=z;}
        public static Vector3 zero {get{return new Vector3(0,0,0);}}
        public static Vector3 up {get{return new Vector3(0,1,0);}}
        public static Vector3 operator +(Vector3 a,Vector3 b){return new Vector3(a.x+b.x,a.y+b.y,a.z+b.z);}
        public static Vector3 operator *(Vector3 a,float b){return new Vector3(a.x*b,a.y*b,a.z*b);}
    }
    public sealed class Transform
    {
        public Vector3 position,eulerAngles;
        public void LookAt(Vector3 target){eulerAngles=new Vector3(16,30,0);}
    }
    public sealed class Camera {public Transform transform=new Transform();}
    public struct Color {public Color(float r,float g,float b){} public static Color HSVToRGB(float h,float s,float v){return new Color();}}
    public static class QualitySettings {public static int vSyncCount;}
    public static class Application {public static int targetFrameRate;}
    public sealed class GameObject {public void AddComponent<T>(){}}
}
namespace Paradize
{
    public sealed class FixtureIsland {public Dictionary<string,Vector3> DistrictPositions=new Dictionary<string,Vector3>();}
    public sealed class FixtureOcean {public void Initialize(){}}
    public sealed class IslandJourneyValidation {}
    public partial class IslandSession
    {
        public FixtureIsland Island=new FixtureIsland();
        public FixtureOcean Ocean=new FixtureOcean();
        public Camera View=new Camera();
        public Transform SunnyCharacter;
        public GameObject gameObject=new GameObject();
        public bool Stopped;
        public string ActiveDistrict="Command",SunnyMessage="Synthetic Sunny answer";
        public float yaw,pitch;
        public int page,knowledgeChecks,coroutines;
        public bool panel,showAgents;
        public Dictionary<string,Vector3> Spawned=new Dictionary<string,Vector3>();
#if DIRECTORY
        public readonly IslandAgentDirectory agentDirectory=new IslandAgentDirectory();
#endif
        public Transform CreateCharacter(string name,Color color,Vector3 at){Spawned.Add(name,at);return new Transform();}
        public object CaptureIfRequested(){return null;}
        public object CheckSunny(){return null;}
        public object CheckKnowledge(){knowledgeChecks++;return null;}
        public void StartCoroutine(object routine){coroutines++;}
        public void Initialize(){Start();}
    }
}
class IslandAgentDirectoryTests
{
    static int checks;
    static readonly string[] ExpectedNames={"SUNNY","ARCHIVIST","LEDGER","EVE","ATLAS","DIRECTOR","SENTINEL","GODFRY","STORMY","MASKED"};
    static readonly string[] ExpectedIds={"sunny","archivist","ledger","eve","atlas","director","sentinel","godfry","stormy","masked"};
    static readonly int[] ExpectedDistricts={0,1,2,3,4,5,6,6,6,6};
    static void Check(bool value,string label){if(!value)throw new Exception(label);checks++;}
    static bool Same(Vector3 a,Vector3 b){return a.x==b.x && a.y==b.y && a.z==b.z;}
    static IslandSession Fixture()
    {
        var session=new IslandSession();
        for(int i=0;i<IslandSession.Keys.Length;i++)session.Island.DistrictPositions.Add(IslandSession.Keys[i],new Vector3(i*100,7,i*50));
        return session;
    }
    static void Main()
    {
        var session=Fixture();
        session.Initialize();
        Check(session.Spawned.Count==10,"all ten existing characters spawn once");
        for(int i=0;i<ExpectedNames.Length;i++)
        {
            var position=i==0?Vector3.zero:session.Island.DistrictPositions[IslandSession.Keys[ExpectedDistricts[i]]]+Vector3.up*3;
            if(i==7)position+=new Vector3(-6,0,0);
            if(i==8)position+=new Vector3(0,0,6);
            if(i==9)position+=new Vector3(6,0,0);
            Check(session.Spawned.ContainsKey(ExpectedNames[i]) && Same(session.Spawned[ExpectedNames[i]],position),"preserved character position: "+ExpectedNames[i]);
        }
        for(int i=0;i<7;i++)
        {
            session.SunnyMessage="Retained answer "+i;
            session.Visit(i);
            Check(session.SunnyMessage=="Retained answer "+i,"district navigation must retain Sunny's answer: "+i);
            Check(session.ActiveDistrict==IslandSession.Names[i] && session.page==i,"district selection remains functional");
            Check(Same(session.View.transform.position,session.Island.DistrictPositions[IslandSession.Keys[i]]+new Vector3(24,17,-38)),"district arrival remains unchanged");
        }
        Check(session.knowledgeChecks==1,"knowledge district retains its existing refresh");
        var before=session.View.transform.position;
        int refreshes=session.knowledgeChecks;
        session.Stopped=true;
        session.Visit(1);
        Check(Same(before,session.View.transform.position) && session.page==6 && session.knowledgeChecks==refreshes,"STOP still blocks navigation and knowledge refresh");
        session.Stopped=false;
        foreach(var invalid in new[]{-1,7,int.MaxValue})session.Visit(invalid);
        session.Island.DistrictPositions.Remove("finance");session.Visit(2);
        var island=session.Island;session.Island=null;session.Visit(0);session.Island=island;
        var camera=session.View;session.View=null;session.Visit(0);session.View=camera;
        Check(Same(before,session.View.transform.position) && session.page==6 && session.SunnyMessage=="Retained answer 6","invalid or unavailable destinations preserve view and answer");
#if DIRECTORY
        var directory=new IslandAgentDirectory();
        Check(directory.Agents.Count==10 && directory.Selected.Id=="sunny","directory starts with Sunny and all ten identities");
        for(int i=0;i<ExpectedNames.Length;i++)
        {
            var agent=directory.Agents[i];
            Check(agent.Id==ExpectedIds[i] && agent.Name==ExpectedNames[i] && agent.DistrictIndex==ExpectedDistricts[i],"catalog identity and mapping: "+ExpectedNames[i]);
            Check(directory.Select(agent.Id) && directory.Selected==agent,"select each catalog identity");
            if(i>0)Check(agent.ConnectionLabel=="Not connected" && agent.Availability=="This character cannot start work or take actions.","worker presence never asserts activation");
        }
        Check(directory.Agents[0].ConnectionLabel==null,"Sunny uses the live session's existing connection display");
        foreach(var invalid in new[]{null,"","unknown","SUNNY"," sunny","sunny "})
            Check(!directory.Select(invalid) && directory.Selected.Id=="masked","invalid selection retains previous identity");
        bool immutable=false;
        try{((IList<IslandAgent>)directory.Agents)[0]=directory.Agents[1];}catch(NotSupportedException){immutable=true;}
        Check(immutable,"catalog cannot be changed by a caller");
        session.Stopped=true;
        session.SunnyMessage="Keep this answer and its sources";
        int calls=session.coroutines;
        for(int i=0;i<ExpectedIds.Length;i++)
        {
            session.panel=false;session.showAgents=false;
            Check(session.SelectAgent(ExpectedIds[i]) && session.panel && session.showAgents,"selection opens Sunny directory");
            Check(session.SunnyMessage=="Keep this answer and its sources" && session.Stopped && Same(before,session.View.transform.position) && calls==session.coroutines,"read-only selection preserves reply, pause and navigation without starting work");
        }
        session.panel=false;session.showAgents=false;
        Check(!session.SelectAgent("unknown") && !session.panel && !session.showAgents && session.agentDirectory.Selected.Id=="masked","unknown selection has no UI effect");
        Check(new IslandAgentDirectory().Selected.Id=="sunny","selection is isolated between sessions");
#endif
        Console.WriteLine(checks+" agent directory and navigation checks passed (Unity boundary doubles; no editor/player)");
    }
}

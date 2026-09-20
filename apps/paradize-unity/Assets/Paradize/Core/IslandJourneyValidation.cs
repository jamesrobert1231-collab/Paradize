using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Profiling;

namespace Paradize
{
    /// <summary>Opt-in standalone acceptance journey, using synthetic conversation only.</summary>
    public sealed class IslandJourneyValidation : MonoBehaviour
    {
        public static bool Finished { get; private set; }
        public static bool Passed { get; private set; }
        IEnumerator Start()
        {
            Finished=false;Passed=false;Application.runInBackground=true;
            var session=GetComponent<IslandSession>();
            var position=session.View.transform.position;var rotation=session.View.transform.rotation;
            float deadline=Time.realtimeSinceStartup+12;
            while(!session.IsChatReady && Time.realtimeSinceStartup<deadline)yield return null;
            if(!session.IsChatReady){Fail("Sunny authenticated local health was not ready");yield break;}
            for(int i=0;i<IslandSession.Keys.Length;i++)
            {
                session.Visit(i);
                if(session.ActiveDistrict!=IslandSession.Names[i]){Fail("District navigation failed: "+i);yield break;}
                var p=session.View.transform.position;
                if(p.y<=session.Island.SampleHeight(p.x,p.z)){Fail("Navigation placed camera under terrain");yield break;}
                yield return null;
            }
            session.Ocean.SetPreviewDays(0);float phase=session.Ocean.Phase01;
            session.Ocean.SetPreviewDays(7);
            if(Mathf.Abs(phase-session.Ocean.Phase01)<.1f){Fail("Lunar preview did not advance");yield break;}
            session.Ocean.SetPreviewDays(0);
            session.StopIsland();var stoppedPosition=session.View.transform.position;
            session.Visit(1);
            if(session.View.transform.position!=stoppedPosition){Fail("STOP allowed navigation");yield break;}
            yield return new WaitForSecondsRealtime(6);
            session.Ask("resume");
            deadline=Time.realtimeSinceStartup+15;
            while((session.Stopped || !session.IsChatReady) && Time.realtimeSinceStartup<deadline)yield return null;
            if(session.Stopped || !session.IsChatReady){Fail("Persistent STOP could not resume");yield break;}
            session.Visit(0);
            session.View.transform.SetPositionAndRotation(position,rotation);
            session.Ask("Introduce yourself as Sunny in one short sentence. Describe only your currently available capability.");
            deadline=Time.realtimeSinceStartup+100;
            int frames=0;float begin=Time.realtimeSinceStartup;
            while(session.IsReplyPending && Time.realtimeSinceStartup<deadline){frames++;yield return null;}
            if(!session.LastReplySucceeded){Fail("Unity to Sunny to local Ollama conversation failed");yield break;}
            if(session.SunnyCharacter==null || Vector3.Distance(session.SunnyCharacter.position,session.View.transform.position)>10){Fail("Sunny companion did not follow owner");yield break;}
            float duration=Time.realtimeSinceStartup-begin;
            Debug.Log("PARADIZE_JOURNEY_PASS districts=7 lunarPreview=passed stopNavigation=passed localChat=passed companion=passed sampleSeconds="+duration.ToString("F2")+" sampleFps="+(frames/Mathf.Max(.01f,duration)).ToString("F1")+" unityAllocatedMiB="+(Profiler.GetTotalAllocatedMemoryLong()/1048576));
            Passed=true;Finished=true;
        }
        static void Fail(string reason){Debug.LogError("PARADIZE_JOURNEY_FAILED: "+reason);Finished=true;Passed=false;}
    }
}

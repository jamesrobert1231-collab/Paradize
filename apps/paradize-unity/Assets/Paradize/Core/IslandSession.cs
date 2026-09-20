using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
using Paradize.World;

namespace Paradize
{
    /// <summary>Owner's local island session. No network listeners or reusable authority in the scene.</summary>
    public sealed class IslandSession : MonoBehaviour
    {
        public IslandGenerator Island;
        public OceanLunarSystem Ocean;
        public Camera View;
        public Light Sun;
        public bool Stopped;
        public string ActiveDistrict = "Command";
        public string SunnyMessage = "Welcome home. I am Sunny. Your island is ready to explore. Select a district or ask me to take you there. Connected services will appear here after their identity and data checks pass.";
        public Transform SunnyCharacter;
        public GameObject SunnyAvatar;
        public AnimationClip SunnyBreathing;
        float yaw, pitch = 16, previewDays;
        string input = "";
        bool useKnowledge;
        string knowledgeQuery = "";
        bool panel = true;
        string token, ownerTokenFile, connection="Local controls";
        string sourceCopyStatus="";
        bool savingSource;
        KnowledgeRecord[] displayedSources=new KnowledgeRecord[0];
        bool busy, chatReady, cancelling;
        int requestGeneration;
        UnityWebRequest pendingChat;
        Vector2 panelScroll, messageScroll;
        [Serializable] sealed class ChatTurn { public string role; public string content; }
        [Serializable] sealed class ChatInput { public string message; public ChatTurn[] history; }
        [Serializable] sealed class GroundedChatInput { public string message; public ChatTurn[] history; public string knowledgeQuery; }
        readonly List<ChatTurn> history=new List<ChatTurn>();
        public bool IsChatReady => chatReady;
        public bool IsReplyPending => busy;
        public bool LastReplySucceeded { get; private set; }
        [Serializable] sealed class BridgeReply { public string status; public string message; public string model; public string retrievalStatus; public KnowledgeRecord[] sources; }
        [Serializable] sealed class KnowledgeRecord { public string id; public string citation; public string title; public string snippet; public string source; public string originalSha256; public string uncertainty; }
        [Serializable] sealed class KnowledgeReply { public string status; public string message; public KnowledgeRecord[] results; }
        sealed class SourceDownloadHandler : DownloadHandlerScript
        {
            readonly MemoryStream bytes=new MemoryStream();
            public bool Rejected {get;private set;}
            public SourceDownloadHandler():base(new byte[65536]){}
            protected override void ReceiveContentLengthHeader(ulong contentLength)
            {if(contentLength==0 || contentLength>SourceCopyStore.MaximumBytes)Rejected=true;}
            protected override bool ReceiveData(byte[] data,int length)
            {
                if(Rejected || data==null || length<0 || length>data.Length || bytes.Length+length>SourceCopyStore.MaximumBytes)
                {Rejected=true;return false;}
                bytes.Write(data,0,length);return true;
            }
            public byte[] CopyBytes(){return bytes.ToArray();}
            public void ClearBytes(){bytes.SetLength(0);bytes.Dispose();}
        }
        int page;
        GUIStyle title, small, body, button, label;
        Texture2D panelTexture;
        public static readonly string[] Keys = {"command", "knowledge", "finance", "crm", "world", "studio", "agents"};
        public static readonly string[] Names = {"Command", "Knowledge", "Finance", "Business", "World", "Studio", "Agents"};
        public static readonly string[] Details = {
            "Owner command plaza • Sunny is always one click away. Local island navigation is active.",
            "Second Brain / AIS-OS • Knowledge district reserved. Source import and provenance reconciliation pending.",
            "Finance / credit recovery • Private records stay in their original stores until a verified migration. No financial actions enabled.",
            "Eve / CRM / Tech Help • Shared business district. Agent, database and consent adapters pending qualification.",
            "Prelude / HQ / Globe • Globe build passed. Authenticated live-feed service and Unity bridge pending. Existing world still preserved separately.",
            "HyperFrames / video-use • One planned studio. Render and media adapters pending. Fractal experiments remain optional research.",
            "Agents / security / devices • Character representations are available. Worker permissions and persistent identity adapters pending. Phone control disabled."
        };

        void Start()
        {
            QualitySettings.vSyncCount = 0;
            Application.targetFrameRate = 45;
            if (Ocean != null) Ocean.Initialize();
            if (View != null) { yaw = View.transform.eulerAngles.y; pitch = View.transform.eulerAngles.x; }
            if (SunnyCharacter == null) SunnyCharacter = CreateCharacter("SUNNY", new Color(1f,.72f,.3f), Vector3.zero);
            for (int i=1;i<Keys.Length;i++)
                if (Island != null && Island.DistrictPositions.TryGetValue(Keys[i],out var p))
                    CreateCharacter(new[]{"","ARCHIVIST","LEDGER","EVE","ATLAS","DIRECTOR","SENTINEL"}[i], Color.HSVToRGB(i/8f,.5f,1),p+Vector3.up*3f);
            StartCoroutine(CaptureIfRequested());
            StartCoroutine(CheckSunny());
            if(Array.IndexOf(Environment.GetCommandLineArgs(),"--verify-journey")>=0) gameObject.AddComponent<IslandJourneyValidation>();
            if(Island!=null && Island.DistrictPositions.TryGetValue("agents",out var agentPlaza))
            {
                CreateCharacter("GODFRY",new Color(.7f,.5f,1),agentPlaza+new Vector3(-6,3,0));
                CreateCharacter("STORMY",new Color(.3f,.8f,1),agentPlaza+new Vector3(0,3,6));
                CreateCharacter("MASKED",new Color(.8f,.9f,.9f),agentPlaza+new Vector3(6,3,0));
            }
        }

        public Transform CreateCharacter(string name, Color color, Vector3 at)
        {
            if (name == "SUNNY" && SunnyAvatar != null) {
                var human = new GameObject("SUNNY character");
                human.transform.position = at;
                Instantiate(SunnyAvatar, human.transform, false);
                human.AddComponent<HumanAvatarPresence>().Initialize(SunnyBreathing, View, this);
                return human.transform;
            }
            var root = new GameObject(name + " character");
            root.transform.position = at;
            root.transform.localScale = Vector3.one;
            root.tag = "Untagged";

            Color warm = Shift(color, 0.06f, 0.1f);
            Color cool = Shift(color, -0.12f, 0.18f);
            Color face = Blend(new Color(0.92f, 0.80f, 0.70f), WarmBase(name), 0.32f + Hash01(name) * .22f);
            Color hair = Blend(new Color(0.22f, 0.17f, 0.11f), new Color(0.07f, 0.04f, 0.02f), Mathf.Sin(name.Length * 0.31f) * .5f + .5f);
            Color shirt = Blend(warm, color, 0.64f);
            Color shoe = Blend(new Color(0.16f, 0.16f, 0.17f), cool, .15f);

            Material skin = CreateHumanoidMaterial("Skin", face, 0.04f, 0.85f);
            Material shirtMat = CreateHumanoidMaterial("Cloth", shirt, 0.08f, 0.23f);
            Material trouserMat = CreateHumanoidMaterial("Bottom", cool, 0.10f, 0.33f);
            Material hairMat = CreateHumanoidMaterial("Hair", hair, 0.02f, 0.55f);
            Material eyeMat = CreateHumanoidMaterial("Eye", new Color(0.09f, 0.09f, 0.10f), 0f, 0.2f);
            Material irisMat = CreateHumanoidMaterial("Iris", new Color(0.23f, 0.28f, 0.35f), 0f, 0.2f);
            Material shoeMat = CreateHumanoidMaterial("Shoes", shoe, 0.35f, 0.35f);

            float height = 1.60f + Hash01(name + "h") * .38f;
            var body = GameObject.CreatePrimitive(PrimitiveType.Capsule); body.name = "Body"; body.transform.SetParent(root.transform, false);
            body.transform.localScale = new Vector3(0.58f, 0.52f, 0.30f);
            body.transform.localPosition = new Vector3(0, 0.72f, 0);
            body.GetComponent<Renderer>().sharedMaterial = shirtMat;

            var torso = GameObject.CreatePrimitive(PrimitiveType.Sphere); torso.name = "Torso"; torso.transform.SetParent(root.transform, false);
            torso.transform.localScale = new Vector3(0.54f, 0.65f, 0.31f);
            torso.transform.localPosition = new Vector3(0, 1.03f, 0);
            torso.GetComponent<Renderer>().sharedMaterial = shirtMat;

            var hips = GameObject.CreatePrimitive(PrimitiveType.Capsule); hips.name = "Hips"; hips.transform.SetParent(root.transform, false);
            hips.transform.localScale = new Vector3(0.55f, 0.33f, 0.31f);
            hips.transform.localPosition = new Vector3(0, 0.34f, 0.03f);
            hips.GetComponent<Renderer>().sharedMaterial = trouserMat;

            var head = GameObject.CreatePrimitive(PrimitiveType.Sphere); head.name = "Head"; head.transform.SetParent(root.transform, false);
            head.transform.localScale = new Vector3(0.33f, 0.38f, 0.33f);
            head.transform.localPosition = new Vector3(0, 1.58f, 0);
            head.GetComponent<Renderer>().sharedMaterial = skin;

            var jaw = GameObject.CreatePrimitive(PrimitiveType.Cylinder); jaw.name = "Jaw"; jaw.transform.SetParent(head.transform, false);
            jaw.transform.localScale = new Vector3(0.56f, 0.28f, 0.56f);
            jaw.transform.localPosition = new Vector3(0, -0.42f, 0.10f);
            jaw.transform.localRotation = Quaternion.Euler(55f, 0, 0);
            jaw.GetComponent<Renderer>().sharedMaterial = CreateHumanoidMaterial("Jaw", face * .92f, 0.01f, 0.6f);

            var neck = GameObject.CreatePrimitive(PrimitiveType.Cylinder); neck.name = "Neck"; neck.transform.SetParent(root.transform, false);
            neck.transform.localScale = new Vector3(0.06f, 0.08f, 0.06f);
            neck.transform.localPosition = new Vector3(0, 1.40f, 0.02f);
            neck.GetComponent<Renderer>().sharedMaterial = skin;

            var leftEye = GameObject.CreatePrimitive(PrimitiveType.Sphere); leftEye.name = "Eye.L"; leftEye.transform.SetParent(root.transform, false);
            leftEye.transform.localScale = new Vector3(0.065f, 0.062f, 0.05f);
            leftEye.transform.localPosition = new Vector3(-0.09f, 1.61f, 0.19f);
            leftEye.GetComponent<Renderer>().sharedMaterial = eyeMat;
            var rightEye = GameObject.CreatePrimitive(PrimitiveType.Sphere); rightEye.name = "Eye.R"; rightEye.transform.SetParent(root.transform, false);
            rightEye.transform.localScale = Vector3.one * 0.065f;
            rightEye.transform.localPosition = new Vector3(0.09f, 1.61f, 0.19f);
            rightEye.GetComponent<Renderer>().sharedMaterial = eyeMat;

            var leftIris = GameObject.CreatePrimitive(PrimitiveType.Sphere); leftIris.name = "Iris.L"; leftIris.transform.SetParent(root.transform, false);
            leftIris.transform.localScale = Vector3.one * 0.028f;
            leftIris.transform.localPosition = new Vector3(-0.093f, 1.618f, 0.22f);
            leftIris.GetComponent<Renderer>().sharedMaterial = irisMat;
            var rightIris = GameObject.CreatePrimitive(PrimitiveType.Sphere); rightIris.name = "Iris.R"; rightIris.transform.SetParent(root.transform, false);
            rightIris.transform.localScale = Vector3.one * 0.028f;
            rightIris.transform.localPosition = new Vector3(0.093f, 1.618f, 0.22f);
            rightIris.GetComponent<Renderer>().sharedMaterial = irisMat;

            var mouth = GameObject.CreatePrimitive(PrimitiveType.Cylinder); mouth.name = "Mouth"; mouth.transform.SetParent(root.transform, false);
            mouth.transform.localScale = new Vector3(0.09f, 0.012f, 0.04f);
            mouth.transform.localPosition = new Vector3(0, 1.48f, 0.2f);
            mouth.GetComponent<Renderer>().sharedMaterial = eyeMat;

            var hairRoot = GameObject.CreatePrimitive(PrimitiveType.Sphere); hairRoot.name = "Hair"; hairRoot.transform.SetParent(root.transform, false);
            hairRoot.transform.localScale = new Vector3(0.34f, 0.15f, 0.32f);
            hairRoot.transform.localPosition = new Vector3(0, 1.68f, 0.03f);
            hairRoot.transform.localRotation = Quaternion.Euler(0, 0, 0);
            hairRoot.GetComponent<Renderer>().sharedMaterial = hairMat;

            for (int i = 0; i < 2; i++)
            {
                float side = i == 0 ? -1f : 1f;
                var arm = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                arm.name = i == 0 ? "Arm.L" : "Arm.R";
                arm.transform.SetParent(root.transform, false);
                arm.transform.localPosition = new Vector3(0.46f * side, 1.06f, 0.05f);
                arm.transform.localScale = new Vector3(0.11f, 0.29f, 0.11f);
                arm.GetComponent<Renderer>().sharedMaterial = shirtMat;

                var foreArm = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                foreArm.name = i == 0 ? "Forearm.L" : "Forearm.R";
                foreArm.transform.SetParent(root.transform, false);
                foreArm.transform.localPosition = new Vector3(0.43f * side, 0.82f, 0.03f);
                foreArm.transform.localScale = new Vector3(0.10f, 0.24f, 0.10f);
                foreArm.GetComponent<Renderer>().sharedMaterial = shirtMat;

                var hand = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                hand.name = i == 0 ? "Hand.L" : "Hand.R";
                hand.transform.SetParent(root.transform, false);
                hand.transform.localPosition = new Vector3(0.41f * side, 0.63f, 0.05f);
                hand.transform.localScale = new Vector3(0.1f, 0.07f, 0.12f);
                hand.GetComponent<Renderer>().sharedMaterial = skin;
            }

            for (int i = 0; i < 2; i++)
            {
                float side = i == 0 ? -1f : 1f;
                var leg = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                leg.name = i == 0 ? "Leg.L" : "Leg.R";
                leg.transform.SetParent(root.transform, false);
                leg.transform.localPosition = new Vector3(0.16f * side, 0.18f, 0.01f);
                leg.transform.localScale = new Vector3(0.13f, 0.34f, 0.13f);
                leg.GetComponent<Renderer>().sharedMaterial = trouserMat;

                var calf = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                calf.name = i == 0 ? "Calf.L" : "Calf.R";
                calf.transform.SetParent(root.transform, false);
                calf.transform.localPosition = new Vector3(0.16f * side, -0.14f, 0.005f);
                calf.transform.localScale = new Vector3(0.11f, 0.34f, 0.11f);
                calf.GetComponent<Renderer>().sharedMaterial = trouserMat;

                var foot = GameObject.CreatePrimitive(PrimitiveType.Cube);
                foot.name = i == 0 ? "Foot.L" : "Foot.R";
                foot.transform.SetParent(root.transform, false);
                foot.transform.localPosition = new Vector3(0.16f * side, -0.46f, 0.11f);
                foot.transform.localScale = new Vector3(0.18f, 0.07f, 0.29f);
                foot.GetComponent<Renderer>().sharedMaterial = shoeMat;
            }

            root.transform.localScale = Vector3.one * Mathf.Lerp(0.92f, 1.05f, Hash01(name));
            head.transform.localScale *= Mathf.Lerp(0.9f, 1.08f, Hash01(name + "g"));
            body.transform.localScale *= Mathf.Lerp(0.94f, 1.08f, Hash01(name + "b"));
            root.transform.position += Vector3.up * 0.03f;

            // Keep facial features attached when the head turns, preserving their world pose.
            foreach (var feature in new[] { leftEye, rightEye, leftIris, rightIris, mouth, hairRoot })
                feature.transform.SetParent(head.transform, true);

            foreach (var col in root.GetComponentsInChildren<Collider>()) Destroy(col);
            var text = new GameObject("Name").AddComponent<TextMesh>();
            text.transform.SetParent(root.transform, false);
            text.transform.localPosition = Vector3.up * (1.95f + height * 0.12f);
            text.text = name;
            text.fontSize = 54;
            text.characterSize = .025f;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = color;
            text.fontStyle = FontStyle.Bold;
            text.GetComponent<MeshRenderer>().sortingOrder = 20;
            root.AddComponent<CharacterPresence>().Initialize(torso.transform, head.transform, View, Hash01(name), text.transform);
            return root.transform;
        }

        static float Hash01(string seed)
        {
            uint hash = 2166136261u;
            foreach (char ch in seed)
            {
                hash ^= ch;
                hash *= 16777619;
            }
            return (hash & 0xFFFFu) / (float)0xFFFF;
        }

        static Color Blend(Color a, Color b, float t)
        {
            return Color.Lerp(a, b, Mathf.Clamp01(t));
        }

        static Color Shift(Color baseColor, float hueShift, float amount)
        {
            Color.RGBToHSV(baseColor, out float h, out float s, out float v);
            h = (h + hueShift) % 1f;
            if (h < 0f) h += 1f;
            s = Mathf.Clamp01(s * (1f + amount * 0.2f));
            v = Mathf.Clamp01(v * (1f + amount * 0.08f));
            return Color.HSVToRGB(h, s, v);
        }

        static Color WarmBase(string seed) => Hash01(seed + "skin") > .5f
            ? new Color(0.96f, 0.86f, 0.73f)
            : new Color(0.88f, 0.78f, 0.68f);

        static Material CreateHumanoidMaterial(string name, Color color, float metallic, float smoothness)
        {
            var material = new Material(Shader.Find("Standard")) { name = "Person " + name };
            material.color = color;
            material.SetFloat("_Metallic", metallic);
            material.SetFloat("_Glossiness", smoothness);
            material.SetFloat("_OcclusionStrength", .8f);
            material.EnableKeyword("_NORMALMAP");
            return material;
        }

        void Update()
        {
            if (View==null) return;
            if (Input.GetKeyDown(KeyCode.F1)) panel=!panel;
            if (Input.GetKeyDown(KeyCode.Escape)) { panel=true; Cursor.lockState=CursorLockMode.None; }
            if (!Stopped && Input.GetMouseButton(1))
            {
                yaw+=Input.GetAxis("Mouse X")*2f; pitch=Mathf.Clamp(pitch-Input.GetAxis("Mouse Y")*2f,-75,80);
                View.transform.rotation=Quaternion.Euler(pitch,yaw,0);
                float speed=Input.GetKey(KeyCode.LeftShift)?95:30;
                Vector3 movement=View.transform.forward*Input.GetAxis("Vertical")+View.transform.right*Input.GetAxis("Horizontal");
                if(Input.GetKey(KeyCode.E)) movement+=Vector3.up; if(Input.GetKey(KeyCode.Q)) movement-=Vector3.up;
                View.transform.position+=movement*speed*Time.deltaTime;
                var p=View.transform.position; p.x=Mathf.Clamp(p.x,-1750,1750); p.z=Mathf.Clamp(p.z,-1750,1750); p.y=Mathf.Clamp(p.y,Mathf.Max(3,Island!=null?Island.SampleHeight(p.x,p.z)+2:3),450); View.transform.position=p;
            }
            if(SunnyCharacter!=null && View!=null)
            {
                var target=View.transform.position+View.transform.forward*5+View.transform.right-Vector3.up*1.2f;
                SunnyCharacter.position=Vector3.Lerp(SunnyCharacter.position,target,1-Mathf.Exp(-4*Time.deltaTime));
                var facing=View.transform.position-SunnyCharacter.position;
                facing.y=0;
                if(facing.sqrMagnitude>0.0001f) SunnyCharacter.rotation=Quaternion.LookRotation(facing);
            }
        }

        public void Visit(int index)
        {
            if(Stopped || Island==null || View==null || index<0 || index>=Keys.Length) return;
            if(!Island.DistrictPositions.TryGetValue(Keys[index],out var p)) return;
            View.transform.position=p+new Vector3(24,17,-38); View.transform.LookAt(p+Vector3.up*7);
            yaw=View.transform.eulerAngles.y; pitch=View.transform.eulerAngles.x; ActiveDistrict=Names[index]; page=index;
            SunnyMessage=Details[index];
        }

        public void Ask(string command)
        {
            if(string.IsNullOrWhiteSpace(command)) return;
            var q=command.Trim().ToLowerInvariant();
            if(q=="stop") { StopIsland(); return; }
            if(q=="resume") { ResumeIsland(); return; }
            if(q.StartsWith("search knowledge "))
            {
                if(busy || cancelling)return;
                if(string.IsNullOrEmpty(token)){SunnyMessage="Open PARADIZE through its launcher to search imported knowledge.";return;}
                StartCoroutine(SearchKnowledge(command.Trim().Substring(17)));return;
            }
            if(q.Contains("moon") || q.Contains("tide")) { SunnyMessage=Ocean!=null?Ocean.StatusLabel:"Ocean is initializing."; return; }
            for(int i=0;i<Keys.Length;i++) if(q==Keys[i] || q==Names[i].ToLowerInvariant() || q=="take me to "+Keys[i] || q=="go to "+Keys[i]) { Visit(i); return; }
            if(chatReady && !busy && !cancelling && !Stopped) {StartCoroutine(Chat(command));return;}
            SunnyMessage="I can take you to Command, Knowledge, Finance, Business, World, Studio or Agents; explain tides; stop; or resume. "+connection+". No external action was executed.";
        }

        UnityWebRequest Request(string path,string json=null)
        {
            var r=new UnityWebRequest("http://127.0.0.1:4318"+path,json==null?"GET":"POST");
            r.downloadHandler=new DownloadHandlerBuffer();r.timeout=100;r.redirectLimit=0;
            r.SetRequestHeader("Authorization","Bearer "+token);
            if(json!=null){r.uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(json));r.SetRequestHeader("Content-Type","application/json");}
            return r;
        }
        IEnumerator SearchKnowledge(string query)
        {
            busy=true;int generation=++requestGeneration;
            displayedSources=new KnowledgeRecord[0];sourceCopyStatus="";
            using(var r=Request("/knowledge/search?q="+Uri.EscapeDataString(query)))
            {
                pendingChat=r;r.timeout=8;
                var operation=BeginRequest(r);
                if(operation!=null)yield return operation;
                if(generation!=requestGeneration)yield break;
                busy=false;pendingChat=null;
                if(operation==null || r.result!=UnityWebRequest.Result.Success || r.downloadHandler.text.Length>32768)
                {SunnyMessage="Knowledge search is unavailable. No original records were changed.";yield break;}
                KnowledgeReply result=null;
                try{result=JsonUtility.FromJson<KnowledgeReply>(r.downloadHandler.text);}catch(Exception){}
                if(result==null || result.status!="complete"){SunnyMessage="Knowledge response could not be validated.";yield break;}
                displayedSources=result.results??new KnowledgeRecord[0];
                var output=new StringBuilder(result.message+"\n");
                foreach(var record in result.results??new KnowledgeRecord[0])
                {
                    output.Append("\n").Append(record.title).Append(" [").Append(record.uncertainty).Append("]\n");
                    output.Append(record.snippet).Append("\nSource: ").Append(record.source);
                    output.Append("\nOriginal SHA-256: ").Append(record.originalSha256).Append("\n");
                }
                SunnyMessage=output.ToString();messageScroll=Vector2.zero;
            }
        }
        static UnityWebRequestAsyncOperation BeginRequest(UnityWebRequest request)
        {
            // Keep the catch outside iterator yield blocks; configuration failures remain readable.
            try { return request.SendWebRequest(); }
            catch (Exception) { return null; }
        }
        static bool TryReply(UnityWebRequest request, out BridgeReply reply)
        {
            reply=null;
            if(request.result!=UnityWebRequest.Result.Success) return false;
            string json=request.downloadHandler.text;
            if(string.IsNullOrEmpty(json) || json.Length>131072) return false;
            try { reply=JsonUtility.FromJson<BridgeReply>(json); }
            catch (Exception) { return false; }
            return reply!=null && !string.IsNullOrEmpty(reply.status);
        }
        IEnumerator CheckSunny()
        {
            chatReady=false;
            var file=Environment.GetEnvironmentVariable("PARADIZE_SUNNY_TOKEN_FILE");
            ownerTokenFile=null;
            try {if(!string.IsNullOrEmpty(file)){token=File.ReadAllText(file).Trim();ownerTokenFile=file;}}catch {token=null;}
            if(string.IsNullOrEmpty(token)){connection="Start with the PARADIZE launcher for private local chat";yield break;}
            using(var r=Request("/health"))
            {
                r.timeout=8;var operation=BeginRequest(r);
                if(operation==null){connection="Sunny service unavailable • local controls ready";yield break;}
                yield return operation;
                if(!TryReply(r,out var reply)){connection="Sunny service unavailable • local controls ready";yield break;}
                if(reply.status=="stopped") {Stopped=true;connection="Sunny paused • resume required";yield break;}
                chatReady=reply.status=="ready";
                connection=chatReady?"Sunny local AI • "+reply.model:"Sunny model unavailable • local controls ready";
            }
        }
        public void AskWithKnowledge(string message, string query)
        {
            if(string.IsNullOrWhiteSpace(message) || string.IsNullOrWhiteSpace(query) || query.Length>200)return;
            if(!chatReady || busy || cancelling || Stopped){SunnyMessage="Reconnect or resume Sunny before asking about imported records.";return;}
            StartCoroutine(Chat(message,query.Trim()));
        }
        string ChatPayload(string message,string query)
        {
            return query==null ? JsonUtility.ToJson(new ChatInput{message=message,history=history.ToArray()})
                : JsonUtility.ToJson(new GroundedChatInput{message=message,history=history.ToArray(),knowledgeQuery=query});
        }
        IEnumerator Chat(string message, string query=null)
        {
            int generation=++requestGeneration;
            busy=true;LastReplySucceeded=false;SunnyMessage="Thinking locally…";messageScroll=Vector2.zero;
            displayedSources=new KnowledgeRecord[0];sourceCopyStatus="";
            string payload=ChatPayload(message,query);
            while(Encoding.UTF8.GetByteCount(payload)>7900 && history.Count>0)
            {
                history.RemoveRange(0,Math.Min(2,history.Count));
                payload=ChatPayload(message,query);
            }
            try
            {
                using(var r=Request("/chat",payload))
                {
                    pendingChat=r;
                    var operation=BeginRequest(r);
                    if(operation==null)
                    {
                        SunnyMessage="Sunny service could not start this request. Local controls remain available.";
                        yield break;
                    }
                    yield return operation;
                    if(generation!=requestGeneration || Stopped) yield break;
                    if(TryReply(r,out var reply) && reply.status=="complete" && !string.IsNullOrWhiteSpace(reply.message))
                    {
                        SunnyMessage=reply.message;LastReplySucceeded=true;
                        if(query!=null)
                        {
                            if(reply.retrievalStatus!="excerpts-found" && reply.retrievalStatus!="no-matches")
                            {SunnyMessage="Sunny did not confirm the requested knowledge search. Reconnect after updating the local service.";LastReplySucceeded=false;yield break;}
                            var evidence=new StringBuilder(reply.message);
                            evidence.Append(reply.retrievalStatus=="no-matches"?"\n\nNo matching imported excerpts; original records may contain more information.":"\n\nRetrieved sources — claims remain unverified:");
                            foreach(var source in reply.sources??new KnowledgeRecord[0])
                                evidence.Append("\n[").Append(source.citation).Append("] ").Append(source.title).Append("\n").Append(source.snippet).Append("\nSource: ").Append(source.source).Append("\nStatus: ").Append(source.uncertainty).Append("\nOriginal SHA-256: ").Append(source.originalSha256).Append("\n");
                            displayedSources=reply.sources??new KnowledgeRecord[0];
                            SunnyMessage=evidence.ToString();
                        }
                        // Brief session context stays in RAM; historical stores are not silently imported.
                        if(query==null && message.Length<=2000 && reply.message.Length<=2000)
                        {
                            history.Add(new ChatTurn{role="user",content=message});history.Add(new ChatTurn{role="assistant",content=reply.message});
                            while(history.Count>6)history.RemoveRange(0,2);
                        }
                    }
                    else SunnyMessage="Sunny could not complete that reply. Local navigation remains available.";
                    messageScroll=Vector2.zero;
                }
            }
            finally
            {
                if(generation==requestGeneration){busy=false;pendingChat=null;}
            }
        }
        public void StopIsland()
        {
            Stopped=true;
            int generation=++requestGeneration;
            if(savingSource)sourceCopyStatus="Source save cancelled. No verified copy was published.";
            if(pendingChat!=null)pendingChat.Abort();
            pendingChat=null;busy=false;
            if(!string.IsNullOrEmpty(token))
            {
                cancelling=true;
                SunnyMessage="Island navigation paused. Requesting cancellation of local Sunny inference.";
                StartCoroutine(CancelChat(generation));
            }
            else SunnyMessage="Local island navigation paused. No Sunny service is connected.";
        }

        IEnumerator SaveSource(KnowledgeRecord source)
        {
            if(busy || cancelling || Stopped || string.IsNullOrEmpty(token) || source==null || !SourceCopyStore.IsDigest(source.id) || !SourceCopyStore.IsDigest(source.originalSha256))yield break;
            int generation=++requestGeneration;
            busy=true;savingSource=true;sourceCopyStatus="Downloading and verifying this source…";
            var download=new SourceDownloadHandler();
            try
            {
                using(var r=Request("/knowledge/original/"+source.id))
                {
                    r.downloadHandler.Dispose();r.downloadHandler=download;r.timeout=30;pendingChat=r;
                    var operation=BeginRequest(r);
                    if(operation!=null)yield return operation;
                    if(generation!=requestGeneration || Stopped)yield break;
                    if(operation==null || r.result!=UnityWebRequest.Result.Success || download.Rejected)
                    {
                        sourceCopyStatus=r.responseCode==404?"This preserved source is no longer available. Nothing was saved.":
                            r.responseCode==503?"The preserved source could not be verified by Sunny. Nothing was saved.":
                            "Source download failed or exceeded 10 MiB. Nothing was saved.";
                        yield break;
                    }
                    byte[] bytes=download.CopyBytes();
                    long expectedLength;
                    if(!long.TryParse(r.GetResponseHeader("Content-Length"),out expectedLength) || expectedLength!=bytes.Length ||
                        !string.Equals(r.GetResponseHeader("Content-Type"),"application/octet-stream",StringComparison.OrdinalIgnoreCase) ||
                        !string.Equals(r.GetResponseHeader("X-Paradize-Original-Sha256"),source.originalSha256,StringComparison.Ordinal) ||
                        !SourceCopyStore.Matches(bytes,source.originalSha256))
                    {sourceCopyStatus="Source fingerprint or download metadata did not match. Nothing was saved.";yield break;}
                    // Give STOP one frame to invalidate a completed download before any source bytes are written.
                    yield return null;
                    if(generation!=requestGeneration || Stopped)yield break;
                    try
                    {
                        string saved=SourceCopyStore.Save(ownerTokenFile,source.id,source.source,source.originalSha256,bytes,()=>generation!=requestGeneration || Stopped);
                        sourceCopyStatus="Verified source copy saved:\n"+saved+"\nThe document was not opened.";
                    }
                    catch(OperationCanceledException){sourceCopyStatus="Source save cancelled. No verified copy was published.";}
                    catch(Exception){sourceCopyStatus="Could not save into protected owner storage. Check free space and reopen PARADIZE through its launcher. No completed copy was published.";}
                }
            }
            finally
            {
                download.ClearBytes();savingSource=false;
                if(generation==requestGeneration){busy=false;pendingChat=null;}
            }
        }
        public void ResumeIsland()
        {
            if(cancelling) {SunnyMessage="Wait for the current STOP or resume acknowledgement.";return;}
            if(string.IsNullOrEmpty(token)){Stopped=false;SunnyMessage="Local navigation resumed; Sunny remains disconnected.";return;}
            cancelling=true;
            StartCoroutine(ResumeSunny(++requestGeneration));
        }
        IEnumerator ResumeSunny(int generation)
        {
            using(var r=Request("/control/resume","{}"))
            {
                r.timeout=5;
                var operation=BeginRequest(r);
                if(operation!=null)yield return operation;
                if(generation!=requestGeneration)yield break;
                cancelling=false;
                if(operation==null || !TryReply(r,out var reply) || reply.status!="resumed")
                {SunnyMessage="Resume could not be confirmed. Navigation remains paused.";yield break;}
                Stopped=false;
                SunnyMessage="Island navigation and local Sunny admission resumed.";
                yield return CheckSunny();
            }
        }
        IEnumerator CancelChat(int generation)
        {
            bool confirmed=false;
            try
            {
                using(var r=Request("/control/stop","{}"))
                {
                    r.timeout=5;
                    var operation=BeginRequest(r);
                    if(operation!=null)
                    {
                        yield return operation;
                        confirmed=TryReply(r,out var reply) && reply.status=="stopped";
                    }
                }
            }
            finally
            {
                if(generation==requestGeneration)
                {
                    cancelling=false;
                    if(Stopped)SunnyMessage=confirmed
                        ? "Local navigation paused; Sunny STOP saved across restarts. Unconnected systems are unchanged."
                        : "Local navigation paused. Sunny cancellation could not be confirmed; its request time limit still applies.";
                }
            }
        }

        void Styles()
        {
            if(title!=null) return;
            panelTexture=new Texture2D(1,1); panelTexture.SetPixel(0,0,new Color(.025f,.055f,.08f,.94f)); panelTexture.Apply();
            title=new GUIStyle(GUI.skin.label){fontSize=25,fontStyle=FontStyle.Bold}; title.normal.textColor=new Color(.85f,.97f,1);
            small=new GUIStyle(GUI.skin.label){fontSize=12,wordWrap=true}; small.normal.textColor=new Color(.53f,.75f,.79f);
            body=new GUIStyle(GUI.skin.label){fontSize=16,wordWrap=true}; body.normal.textColor=new Color(.84f,.91f,.91f);
            label=new GUIStyle(body){fontSize=13};
            button=new GUIStyle(GUI.skin.button){fontSize=13,padding=new RectOffset(9,9,9,9)};
        }
        void OnGUI()
        {
            Styles();
            float scale=Mathf.Clamp(Mathf.Min(Screen.width/1440f,Screen.height/850f),.5f,1.4f); GUI.matrix=Matrix4x4.TRS(Vector3.zero,Quaternion.identity,Vector3.one*scale);
            float w=Screen.width/scale,h=Screen.height/scale;
            float headerWidth=Mathf.Min(420,w-250);
            GUI.DrawTexture(new Rect(20,20,headerWidth,86),panelTexture); GUI.Label(new Rect(38,29,headerWidth-35,35),"P A R A D I Z E",title); GUI.Label(new Rect(39,68,headerWidth-45,26),"OWNER SANCTUARY   /   "+ActiveDistrict.ToUpperInvariant(),small);
            if(GUI.Button(new Rect(w-210,24,184,38),panel?"SUNNY  /  Close":"SUNNY  /  Open",button)) panel=!panel;
            if(GUI.Button(new Rect(w-210,68,184,36),Stopped?"RESUME ISLAND":"STOP ISLAND",button)) {if(Stopped)ResumeIsland();else StopIsland();}
            GUI.DrawTexture(new Rect(20,h-63,w-40,43),panelTexture); GUI.Label(new Rect(35,h-53,w-70,32),"Hold RIGHT MOUSE + WASD to explore  •  Q / E altitude  •  SHIFT faster  •  F1 Sunny   |   Procedural island preview",label);
            if(!panel) return;
            float x=w-406; GUI.DrawTexture(new Rect(x,122,380,h-201),panelTexture);
            GUILayout.BeginArea(new Rect(x+18,136,344,h-229));
            GUILayout.Label("SUNNY",title); GUILayout.Label(connection,small);
            if(!chatReady && GUILayout.Button("Reconnect Sunny",button))StartCoroutine(CheckSunny());
            GUILayout.Space(12);
            panelScroll=GUILayout.BeginScrollView(panelScroll,false,false,GUILayout.ExpandHeight(true));
            // A long answer gets its own bounded viewport so district access stays close by.
            float messageHeight=Mathf.Clamp(body.CalcHeight(new GUIContent(SunnyMessage),305),56,155);
            messageScroll=GUILayout.BeginScrollView(messageScroll,false,false,GUILayout.Height(messageHeight));
            GUILayout.Label(SunnyMessage,body);GUILayout.EndScrollView();GUILayout.Space(15);
            if(displayedSources.Length>0)
            {
                GUILayout.Label("SOURCES FROM LAST RETRIEVAL",small);
                foreach(var source in displayedSources)
                {
                    if(source==null)continue;
                    GUILayout.Label((string.IsNullOrEmpty(source.citation)?"":"["+source.citation+"] ")+source.title,label);
                    GUI.enabled=!busy && !cancelling && !Stopped && !string.IsNullOrEmpty(token) && SourceCopyStore.IsDigest(source.id) && SourceCopyStore.IsDigest(source.originalSha256);
                    if(GUILayout.Button("Save source copy",button))StartCoroutine(SaveSource(source));
                    GUI.enabled=true;
                }
            }
            if(!string.IsNullOrEmpty(sourceCopyStatus)){GUILayout.Label(sourceCopyStatus,label);GUILayout.Space(12);}
            GUILayout.Label("ISLAND DISTRICTS",small);
            for(int i=0;i<Names.Length;i++) { if(GUILayout.Button(Names[i]+(page==i?"   •":""),button)) Visit(i); }
            GUILayout.Space(12); GUILayout.Label("LUNAR PREVIEW",small);
            float nextPreview=GUILayout.HorizontalSlider(previewDays,0,29.53059f);
            if(!Mathf.Approximately(nextPreview,previewDays)) {previewDays=nextPreview;if(Ocean!=null)Ocean.SetPreviewDays(previewDays);}
            if(Ocean!=null)GUILayout.Label(Ocean.StatusLabel,small);
            if(previewDays!=0f && GUILayout.Button("Return to live UTC",button)){previewDays=0f;if(Ocean!=null)Ocean.SetPreviewDays(0f);}
            GUILayout.EndScrollView();
            useKnowledge=GUILayout.Toggle(useKnowledge,"Use imported knowledge for this answer");
            if(useKnowledge)
            {
                GUILayout.Label("Search words for the source records",small);
                knowledgeQuery=GUILayout.TextField(knowledgeQuery,200,GUILayout.Height(26));
            }
            GUILayout.Space(10); GUI.SetNextControlName("SunnyInput"); input=GUILayout.TextField(input,240,GUILayout.Height(30));
            bool canAsk=!busy && !cancelling && !string.IsNullOrWhiteSpace(input) && (!useKnowledge || !string.IsNullOrWhiteSpace(knowledgeQuery));
            bool enter=Event.current.type==EventType.KeyDown && Event.current.keyCode==KeyCode.Return && GUI.GetNameOfFocusedControl()=="SunnyInput" && canAsk;
            GUI.enabled=canAsk;
            GUILayout.BeginHorizontal();
            bool submit=GUILayout.Button(cancelling?"Cancelling…":savingSource?"Saving source…":busy?"Sunny is thinking…":"Ask Sunny",button,GUILayout.Height(36));
            bool search=GUILayout.Button("Search knowledge",button,GUILayout.Height(36));
            GUILayout.EndHorizontal();
            GUI.enabled=true;
            if(submit || enter || search) {if(enter)Event.current.Use();if(!search && useKnowledge)AskWithKnowledge(input,knowledgeQuery);else Ask(search?"search knowledge "+input:input);input="";messageScroll=Vector2.zero;GUI.FocusControl(null);}
            GUILayout.EndArea();
        }
        IEnumerator CaptureIfRequested()
        {
            string[] args=Environment.GetCommandLineArgs(); int idx=Array.IndexOf(args,"--capture");
            if(idx<0 || idx+1>=args.Length) yield break;
            bool quit=Array.IndexOf(args,"--quit-after-capture")>=0;
            if(SystemInfo.graphicsDeviceType==UnityEngine.Rendering.GraphicsDeviceType.Null || (Application.isEditor && Application.isBatchMode))
            {
                Debug.LogError("PARADIZE_CAPTURE_FAILED: capture requires a graphics-enabled standalone player.");
                if(quit)Application.Quit(1);
                yield break;
            }
            bool previousBackground=Application.runInBackground;
            Application.runInBackground=true;
            if(Array.IndexOf(args,"--verify-journey")>=0)
            {
                float deadline=Time.realtimeSinceStartup+115;
                while(!IslandJourneyValidation.Finished && Time.realtimeSinceStartup<deadline)yield return null;
                if(!IslandJourneyValidation.Passed){Debug.LogError("PARADIZE_CAPTURE_FAILED: integration journey did not pass.");if(quit)Application.Quit(1);yield break;}
            }
            yield return new WaitForSecondsRealtime(8);
            yield return new WaitForEndOfFrame();
            bool success=false;
            Texture2D screenshot=null;
            try
            {
                string destination=Path.GetFullPath(args[idx+1]);
                screenshot=ScreenCapture.CaptureScreenshotAsTexture();
                if(screenshot==null || screenshot.width<1 || screenshot.height<1)throw new IOException("No rendered image");
                float darkest=1f,lightest=0f;int visibleSamples=0,totalSamples=0;
                for(int sy=0;sy<screenshot.height;sy+=16)
                for(int sx=0;sx<screenshot.width;sx+=16)
                {
                    Color sample=screenshot.GetPixel(sx,sy);
                    float luminance=Mathf.Max(sample.r,Mathf.Max(sample.g,sample.b));
                    darkest=Mathf.Min(darkest,luminance);lightest=Mathf.Max(lightest,luminance);
                    if(luminance>.03f)visibleSamples++;
                    totalSamples++;
                }
                if(lightest-darkest<.03f || visibleSamples<totalSamples/100)throw new IOException("Blank rendered image; visible player verification required");
                byte[] png=screenshot.EncodeToPNG();
                if(png==null || png.Length<8 || png[0]!=137 || png[1]!=80 || png[2]!=78 || png[3]!=71)throw new IOException("Invalid PNG");
                Directory.CreateDirectory(Path.GetDirectoryName(destination));
                File.WriteAllBytes(destination,png);
                success=File.Exists(destination) && new FileInfo(destination).Length==png.Length;
                if(!success)throw new IOException("Capture write was incomplete");
                Debug.Log("PARADIZE_CAPTURE_READY: "+screenshot.width+"x"+screenshot.height+" bytes="+png.Length);
            }
            catch(Exception error){Debug.LogError("PARADIZE_CAPTURE_FAILED: "+error.GetType().Name);}
            finally
            {
                if(screenshot!=null)Destroy(screenshot);
                Application.runInBackground=previousBackground;
            }
            if(quit)Application.Quit(success?0:1);
        }

        void OnDestroy()
        {
            requestGeneration++;
            if(pendingChat!=null)pendingChat.Abort();
            pendingChat=null;token=null;ownerTokenFile=null;
            if(panelTexture!=null)Destroy(panelTexture);
        }
    }
}

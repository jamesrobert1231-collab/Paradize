using UnityEngine;
using UnityEngine.Animations;
using UnityEngine.Playables;

namespace Paradize
{
    public sealed class HumanAvatarPresence : MonoBehaviour
    {
        PlayableGraph graph;
        AnimationClipPlayable motion;
        Camera viewer;
        Transform label;
        IslandSession session;
        float clock, duration;

        public void Initialize(AnimationClip clip, Camera camera, IslandSession owner)
        {
            viewer = camera; session = owner;
            var text = new GameObject("SUNNY name").AddComponent<TextMesh>();
            label = text.transform; label.SetParent(transform, false); label.localPosition = Vector3.up * 1.95f;
            text.text = "SUNNY"; text.fontSize = 54; text.characterSize = .025f;
            text.anchor = TextAnchor.MiddleCenter; text.color = new Color(1, .85f, .35f);
            if (clip == null) return;
            var animator = GetComponentInChildren<Animator>();
            if (animator == null) return;
            animator.applyRootMotion = false;
            graph = PlayableGraph.Create("Sunny avatar breathing");
            graph.SetTimeUpdateMode(DirectorUpdateMode.Manual);
            motion = AnimationClipPlayable.Create(graph, clip);
            var output = AnimationPlayableOutput.Create(graph, "Body", animator);
            output.SetSourcePlayable(motion);
            duration = clip.length; graph.Play();
        }

        void LateUpdate()
        {
            if (graph.IsValid() && duration > 0) {
                if (session == null || !session.Stopped) clock += Time.deltaTime;
                motion.SetTime(Mathf.Repeat(clock, duration)); graph.Evaluate(0);
            }
            if (viewer != null && label != null) {
                var direction = label.position - viewer.transform.position;
                if (direction.sqrMagnitude > .001f) label.rotation = Quaternion.LookRotation(direction);
            }
        }

        void OnDestroy() { if (graph.IsValid()) graph.Destroy(); }
    }
}

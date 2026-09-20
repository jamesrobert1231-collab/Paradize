using UnityEngine;

namespace Paradize
{
    /// <summary>Subtle presentation motion for procedural proxies; never drives agent actions.</summary>
    public sealed class CharacterPresence : MonoBehaviour
    {
        Transform chest, head, nameLabel;
        Camera viewer;
        Vector3 chestScale;
        Quaternion headRest;
        float phase;

        public void Initialize(Transform torso, Transform face, Camera camera, float seed, Transform label)
        {
            chest = torso;
            head = face;
            viewer = camera;
            nameLabel = label;
            chestScale = chest.localScale;
            headRest = head.localRotation;
            phase = seed * Mathf.PI * 2f;
        }

        void LateUpdate()
        {
            if (chest == null || head == null) return;
            float breath = Mathf.Sin(Time.time * 1.35f + phase);
            chest.localScale = Vector3.Scale(chestScale, new Vector3(1f, 1f + breath * .006f, 1f + breath * .012f));
            var desired = headRest;
            if (viewer != null)
            {
                var direction = transform.InverseTransformDirection(viewer.transform.position - head.position);
                if (direction.sqrMagnitude > .01f && direction.sqrMagnitude < 225f && direction.z > 0f)
                {
                    float yaw = Mathf.Clamp(Mathf.Atan2(direction.x, direction.z) * Mathf.Rad2Deg, -35f, 35f);
                    float pitch = Mathf.Clamp(-Mathf.Atan2(direction.y, new Vector2(direction.x, direction.z).magnitude) * Mathf.Rad2Deg, -15f, 15f);
                    desired = headRest * Quaternion.Euler(pitch, yaw, 0f);
                }
            }
            head.localRotation = Quaternion.Slerp(head.localRotation, desired, 1f - Mathf.Exp(-3f * Time.deltaTime));
            if (viewer != null && nameLabel != null)
            {
                var awayFromViewer = nameLabel.position - viewer.transform.position;
                if (awayFromViewer.sqrMagnitude > .001f) nameLabel.rotation = Quaternion.LookRotation(awayFromViewer, viewer.transform.up);
            }
        }

        void OnDisable()
        {
            if (chest != null) chest.localScale = chestScale;
            if (head != null) head.localRotation = headRest;
        }
    }
}

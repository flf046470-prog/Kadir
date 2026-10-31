using UnityEngine;

namespace Derinlik
{
    /// <summary>
    /// Sounds synthesised at runtime, so the prototype ships with no third-party audio
    /// (no licence questions). Replace with recorded MetaSound-quality assets in Phase 2.
    /// Levels are kept moderate: nothing here is meant to be physically uncomfortable.
    /// </summary>
    public static class ProceduralAudio
    {
        const int Rate = 44100;
        static AudioClip footstep, distantSteps, doorSlam, drone, latch, drip;

        public static AudioClip Footstep => footstep ??= Make("Footstep", 0.18f, (t, r) =>
            Noise(r) * Env(t, 0.004f, 0.06f) * 0.5f + Mathf.Sin(t * 2f * Mathf.PI * 90f) * Env(t, 0.002f, 0.05f) * 0.35f);

        /// <summary>Four slow, distant steps with a stone-corridor tail.</summary>
        public static AudioClip DistantSteps => distantSteps ??= Make("DistantSteps", 3.2f, (t, r) =>
        {
            float s = 0f;
            for (int i = 0; i < 4; i++)
            {
                float lt = t - i * 0.72f;
                if (lt < 0f) continue;
                s += (Noise(r) * 0.4f + Mathf.Sin(lt * 2f * Mathf.PI * 70f) * 0.6f) * Env(lt, 0.006f, 0.22f);
            }
            return s * 0.35f;
        });

        public static AudioClip DoorSlam => doorSlam ??= Make("DoorSlam", 1.6f, (t, r) =>
            (Noise(r) * 0.6f + Mathf.Sin(t * 2f * Mathf.PI * 55f) * 0.8f + Mathf.Sin(t * 2f * Mathf.PI * 110f) * 0.3f) * Env(t, 0.003f, 0.35f) * 0.6f);

        public static AudioClip Latch => latch ??= Make("Latch", 0.25f, (t, r) =>
            (Mathf.Sin(t * 2f * Mathf.PI * 1800f) * 0.3f + Noise(r) * 0.3f) * Env(t, 0.001f, 0.03f));

        public static AudioClip Drip => drip ??= Make("Drip", 0.4f, (t, r) =>
            Mathf.Sin(t * 2f * Mathf.PI * Mathf.Lerp(1400f, 700f, t / 0.4f)) * Env(t, 0.001f, 0.05f) * 0.25f);

        /// <summary>Low room tone with a slow electrical beat; loop it.</summary>
        public static AudioClip Drone => drone ??= Make("Drone", 8f, (t, r) =>
            (Mathf.Sin(t * 2f * Mathf.PI * 50f) * 0.5f + Mathf.Sin(t * 2f * Mathf.PI * 100.5f) * 0.2f + Noise(r) * 0.05f)
            * (0.75f + 0.25f * Mathf.Sin(t * 2f * Mathf.PI * 0.25f)) * 0.12f);

        static float Env(float t, float attack, float decay) => t < attack ? t / attack : Mathf.Exp(-(t - attack) / decay);

        static float Noise(System.Random r) => (float)(r.NextDouble() * 2.0 - 1.0);

        static AudioClip Make(string name, float seconds, System.Func<float, System.Random, float> sample)
        {
            int count = Mathf.CeilToInt(seconds * Rate);
            var data = new float[count];
            var random = new System.Random(name.GetHashCode());
            for (int i = 0; i < count; i++)
                data[i] = Mathf.Clamp(sample(i / (float)Rate, random), -1f, 1f);
            var clip = AudioClip.Create(name, count, 1, Rate, false);
            clip.SetData(data, 0);
            return clip;
        }

        /// <summary>One-shot 3D sound at a position (minDistance/maxDistance in metres).</summary>
        public static void PlayAt(AudioClip clip, Vector3 position, float volume = 1f, float maxDistance = 25f)
        {
            if (clip == null) return;
            var go = new GameObject("OneShot_" + clip.name);
            go.transform.position = position;
            var source = go.AddComponent<AudioSource>();
            source.clip = clip;
            source.volume = volume;
            source.spatialBlend = 1f;
            source.rolloffMode = AudioRolloffMode.Linear;
            source.minDistance = 1f;
            source.maxDistance = maxDistance;
            source.Play();
            Object.Destroy(go, clip.length + 0.1f);
        }
    }
}

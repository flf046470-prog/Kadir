using UnityEngine;

namespace Derinlik
{
    /// <summary>A looping positional ambience (room tone, dripping water) using the built-in procedural clips.</summary>
    [RequireComponent(typeof(AudioSource))]
    public class AmbientLoop : MonoBehaviour
    {
        public string clipName = "Drone";
        [Range(0f, 1f)] public float volume = 0.3f;
        public float maxDistance = 12f;
        [Tooltip("Seconds between drips (Drip only).")]
        public float dripInterval = 2.7f;

        public void Configure(string name, float vol, float max)
        {
            clipName = name == "RoomTone" ? "Drone" : name;
            volume = vol;
            maxDistance = max;
        }

        void Start()
        {
            var source = GetComponent<AudioSource>();
            source.clip = clipName == "Drip" ? ProceduralAudio.Drip : ProceduralAudio.Drone;
            source.loop = true;
            source.volume = volume;
            source.spatialBlend = 1f;
            source.rolloffMode = AudioRolloffMode.Linear;
            source.maxDistance = maxDistance;
            // A drip that loops every 0.4 s would sound like a machine: space it out.
            if (clipName == "Drip") InvokeRepeating(nameof(PlayDrip), 1.3f, dripInterval);
            else source.Play();
        }

        void PlayDrip() => GetComponent<AudioSource>().PlayOneShot(ProceduralAudio.Drip, volume);
    }
}

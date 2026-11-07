using UnrealBuildTool;

public class DerinlikTarget : TargetRules
{
	public DerinlikTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Derinlik");
	}
}

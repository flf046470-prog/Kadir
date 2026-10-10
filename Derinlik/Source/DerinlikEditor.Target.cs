using UnrealBuildTool;

public class DerinlikEditorTarget : TargetRules
{
	public DerinlikEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.Latest;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;
		ExtraModuleNames.Add("Derinlik");
	}
}

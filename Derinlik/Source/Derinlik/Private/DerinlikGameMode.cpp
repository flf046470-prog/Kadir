#include "DerinlikGameMode.h"
#include "Player/DerinlikCharacter.h"
#include "Player/DerinlikPlayerController.h"

ADerinlikGameMode::ADerinlikGameMode()
{
	// A Blueprint child (BP_DerinlikGameMode) should override these with BP_DerinlikCharacter / BP_DerinlikPlayerController.
	DefaultPawnClass = ADerinlikCharacter::StaticClass();
	PlayerControllerClass = ADerinlikPlayerController::StaticClass();
}

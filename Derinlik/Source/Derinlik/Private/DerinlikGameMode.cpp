#include "DerinlikGameMode.h"
#include "Player/DerinlikCharacter.h"

ADerinlikGameMode::ADerinlikGameMode()
{
	// A Blueprint child (BP_DerinlikGameMode) should override this with BP_DerinlikCharacter.
	DefaultPawnClass = ADerinlikCharacter::StaticClass();
}

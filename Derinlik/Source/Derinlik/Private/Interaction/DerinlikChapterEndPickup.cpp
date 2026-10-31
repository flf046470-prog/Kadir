#include "Interaction/DerinlikChapterEndPickup.h"
#include "Player/DerinlikPlayerController.h"

#include "Components/StaticMeshComponent.h"
#include "GameFramework/Pawn.h"

ADerinlikChapterEndPickup::ADerinlikChapterEndPickup()
{
	PrimaryActorTick.bCanEverTick = false;

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	RootComponent = Mesh;
	Mesh->SetCollisionProfileName(TEXT("BlockAllDynamic"));
}

bool ADerinlikChapterEndPickup::CanInteract_Implementation(APawn* Interactor) const
{
	return Interactor != nullptr && !bUsed;
}

FText ADerinlikChapterEndPickup::GetInteractionPrompt_Implementation() const
{
	return Prompt;
}

void ADerinlikChapterEndPickup::Interact_Implementation(APawn* Interactor)
{
	if (bUsed || !Interactor)
	{
		return;
	}
	bUsed = true;
	Mesh->SetVisibility(false);
	Mesh->SetCollisionEnabled(ECollisionEnabled::NoCollision);

	if (ADerinlikPlayerController* PC = Cast<ADerinlikPlayerController>(Interactor->GetController()))
	{
		PC->PlayChapterEnd(ChapterTitle, FadeSeconds);
	}
}

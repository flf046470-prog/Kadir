#include "Interaction/DerinlikDoor.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/Pawn.h"

ADerinlikDoor::ADerinlikDoor()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;

	Hinge = CreateDefaultSubobject<USceneComponent>(TEXT("Hinge"));
	RootComponent = Hinge;

	DoorMesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("DoorMesh"));
	DoorMesh->SetupAttachment(Hinge);
	DoorMesh->SetCollisionProfileName(TEXT("BlockAll"));
}

bool ADerinlikDoor::CanInteract_Implementation(APawn* Interactor) const
{
	return Interactor != nullptr;
}

FText ADerinlikDoor::GetInteractionPrompt_Implementation() const
{
	if (bLocked)
	{
		return LockedPrompt;
	}
	return bIsOpen ? NSLOCTEXT("Derinlik", "DoorClose", "Close") : NSLOCTEXT("Derinlik", "DoorOpen", "Open");
}

void ADerinlikDoor::Interact_Implementation(APawn* Interactor)
{
	if (bLocked)
	{
		// TODO(Phase 1): play locked-handle rattle sound here.
		return;
	}

	// Swing away from the interactor so the door never pushes into the player.
	float Direction = 1.f;
	if (Interactor)
	{
		const FVector ToPlayer = (Interactor->GetActorLocation() - GetActorLocation()).GetSafeNormal2D();
		Direction = FVector::DotProduct(GetActorForwardVector(), ToPlayer) > 0.f ? -1.f : 1.f;
	}
	SetOpen(!bIsOpen, Direction);
}

void ADerinlikDoor::SetOpen(bool bOpen, float Direction)
{
	bIsOpen = bOpen;
	TargetYaw = bOpen ? OpenAngle * FMath::Sign(Direction == 0.f ? 1.f : Direction) : 0.f;
	SetActorTickEnabled(true);
	OnDoorStateChanged.Broadcast(bIsOpen);
}

void ADerinlikDoor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	FRotator Rotation = DoorMesh->GetRelativeRotation();
	Rotation.Yaw = FMath::FInterpConstantTo(Rotation.Yaw, TargetYaw, DeltaSeconds, SwingSpeed);
	DoorMesh->SetRelativeRotation(Rotation);

	if (FMath::IsNearlyEqual(Rotation.Yaw, TargetYaw, 0.1f))
	{
		SetActorTickEnabled(false);
	}
}

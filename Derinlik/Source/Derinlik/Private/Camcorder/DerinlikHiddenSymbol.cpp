#include "Camcorder/DerinlikHiddenSymbol.h"

#include "Components/BoxComponent.h"
#include "Components/DecalComponent.h"

ADerinlikHiddenSymbol::ADerinlikHiddenSymbol()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false;

	TraceVolume = CreateDefaultSubobject<UBoxComponent>(TEXT("TraceVolume"));
	RootComponent = TraceVolume;
	TraceVolume->SetBoxExtent(FVector(4.f, 40.f, 40.f));
	TraceVolume->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	TraceVolume->SetCollisionResponseToAllChannels(ECR_Ignore);
	TraceVolume->SetCollisionResponseToChannel(ECC_Visibility, ECR_Block);

	SymbolDecal = CreateDefaultSubobject<UDecalComponent>(TEXT("SymbolDecal"));
	SymbolDecal->SetupAttachment(TraceVolume);
	SymbolDecal->DecalSize = FVector(16.f, 40.f, 40.f);
	SymbolDecal->SetVisibility(false);
}

void ADerinlikHiddenSymbol::BeginPlay()
{
	Super::BeginPlay();
	SymbolDecal->SetVisibility(bActivated && bStayVisibleAfterActivation);
}

void ADerinlikHiddenSymbol::SetRevealed(bool bRevealed)
{
	const bool bVisible = bRevealed || (bActivated && bStayVisibleAfterActivation);
	SymbolDecal->SetVisibility(bVisible);
}

void ADerinlikHiddenSymbol::Activate()
{
	if (bActivated)
	{
		return;
	}
	bActivated = true;

	MoveStartLocations.Reset();
	for (const AActor* Linked : LinkedActors)
	{
		MoveStartLocations.Add(Linked ? Linked->GetActorLocation() : FVector::ZeroVector);
	}
	MoveElapsed = 0.f;
	SetActorTickEnabled(LinkedActors.Num() > 0);

	OnActivated.Broadcast();
}

void ADerinlikHiddenSymbol::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	MoveElapsed += DeltaSeconds;
	const float Alpha = FMath::Clamp(MoveElapsed / MoveDuration, 0.f, 1.f);
	const float Eased = FMath::InterpEaseInOut(0.f, 1.f, Alpha, 2.f);

	for (int32 Index = 0; Index < LinkedActors.Num(); ++Index)
	{
		if (AActor* Linked = LinkedActors[Index])
		{
			// No sweep: a slab sinking into the floor would otherwise stop on first contact.
			// Linked actors must have Mobility = Movable.
			Linked->SetActorLocation(MoveStartLocations[Index] + MoveOffset * Eased, false, nullptr, ETeleportType::TeleportPhysics);
		}
	}

	if (Alpha >= 1.f)
	{
		SetActorTickEnabled(false);
	}
}

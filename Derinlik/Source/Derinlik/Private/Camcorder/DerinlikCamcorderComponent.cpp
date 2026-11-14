#include "Camcorder/DerinlikCamcorderComponent.h"
#include "Camcorder/DerinlikHiddenSymbol.h"
#include "Derinlik.h"
#include "UI/DerinlikCamcorderOverlayWidget.h"

#include "Camera/CameraComponent.h"
#include "EngineUtils.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"

UDerinlikCamcorderComponent::UDerinlikCamcorderComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = false;
}

void UDerinlikCamcorderComponent::BeginPlay()
{
	Super::BeginPlay();

	OwnerCamera = GetOwner() ? GetOwner()->FindComponentByClass<UCameraComponent>() : nullptr;
	if (OwnerCamera)
	{
		DefaultFieldOfView = OwnerCamera->FieldOfView;
		OwnerCamera->PostProcessBlendWeight = 0.f;
	}
	else
	{
		UE_LOG(LogDerinlik, Warning, TEXT("Camcorder: owner has no CameraComponent."));
	}
}

void UDerinlikCamcorderComponent::SetRaised(bool bInRaised)
{
	if (bRaised == bInRaised)
	{
		return;
	}
	bRaised = bInRaised;

	if (OwnerCamera)
	{
		OwnerCamera->PostProcessBlendWeight = bRaised ? RaisedPostProcessWeight : 0.f;
		OwnerCamera->SetFieldOfView(bRaised ? RaisedFieldOfView : DefaultFieldOfView);
	}

	const APawn* OwnerPawn = Cast<APawn>(GetOwner());
	APlayerController* PC = OwnerPawn ? Cast<APlayerController>(OwnerPawn->GetController()) : nullptr;
	if (bRaised && !OverlayWidget && OverlayWidgetClass && PC && PC->IsLocalController())
	{
		OverlayWidget = CreateWidget<UDerinlikCamcorderOverlayWidget>(PC, OverlayWidgetClass);
	}
	if (OverlayWidget)
	{
		if (bRaised)
		{
			OverlayWidget->ResetTimecode();
			OverlayWidget->AddToViewport(5);
		}
		else
		{
			OverlayWidget->RemoveFromParent();
		}
	}

	DwellTarget = nullptr;
	DwellTime = 0.f;
	SetSymbolsRevealed(bRaised);
	SetComponentTickEnabled(bRaised);
	OnCamcorderToggled.Broadcast(bRaised);
}

void UDerinlikCamcorderComponent::SetSymbolsRevealed(bool bRevealed)
{
	// Phase 1 levels hold a handful of symbols; a world iteration on toggle is cheap enough.
	for (TActorIterator<ADerinlikHiddenSymbol> It(GetWorld()); It; ++It)
	{
		It->SetRevealed(bRevealed);
	}
}

void UDerinlikCamcorderComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	UpdateDwell(DeltaTime);
}

void UDerinlikCamcorderComponent::UpdateDwell(float DeltaTime)
{
	if (!OwnerCamera)
	{
		return;
	}

	const FVector Start = OwnerCamera->GetComponentLocation();
	const FVector End = Start + OwnerCamera->GetForwardVector() * SymbolTraceDistance;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(DerinlikCamcorder), false, GetOwner());

	ADerinlikHiddenSymbol* Seen = nullptr;
	FHitResult Hit;
	if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		Seen = Cast<ADerinlikHiddenSymbol>(Hit.GetActor());
	}

	if (!Seen || Seen->IsActivated())
	{
		DwellTarget = nullptr;
		DwellTime = 0.f;
		return;
	}

	if (Seen != DwellTarget.Get())
	{
		DwellTarget = Seen;
		DwellTime = 0.f;
	}

	DwellTime += DeltaTime;
	if (DwellTime >= Seen->GetRequiredDwellSeconds())
	{
		Seen->Activate();
		OnSymbolActivated.Broadcast(Seen);
		DwellTarget = nullptr;
		DwellTime = 0.f;
	}
}

float UDerinlikCamcorderComponent::GetDwellProgress() const
{
	const ADerinlikHiddenSymbol* Target = DwellTarget.Get();
	if (!Target)
	{
		return 0.f;
	}
	return FMath::Clamp(DwellTime / FMath::Max(Target->GetRequiredDwellSeconds(), KINDA_SMALL_NUMBER), 0.f, 1.f);
}

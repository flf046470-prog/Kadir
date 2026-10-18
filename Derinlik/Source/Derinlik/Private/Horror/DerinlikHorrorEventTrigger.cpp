#include "Horror/DerinlikHorrorEventTrigger.h"
#include "Derinlik.h"
#include "Interaction/DerinlikDoor.h"

#include "Components/BoxComponent.h"
#include "Components/LightComponent.h"
#include "GameFramework/Pawn.h"
#include "Kismet/GameplayStatics.h"
#include "TimerManager.h"

ADerinlikHorrorEventTrigger::ADerinlikHorrorEventTrigger()
{
	PrimaryActorTick.bCanEverTick = false;

	TriggerBox = CreateDefaultSubobject<UBoxComponent>(TEXT("TriggerBox"));
	RootComponent = TriggerBox;
	TriggerBox->SetBoxExtent(FVector(100.f, 100.f, 100.f));
	TriggerBox->SetCollisionProfileName(TEXT("Trigger"));
	TriggerBox->OnComponentBeginOverlap.AddDynamic(this, &ADerinlikHorrorEventTrigger::HandleOverlap);
}

void ADerinlikHorrorEventTrigger::HandleOverlap(UPrimitiveComponent* OverlappedComponent, AActor* OtherActor,
	UPrimitiveComponent* OtherComp, int32 OtherBodyIndex, bool bFromSweep, const FHitResult& SweepResult)
{
	const APawn* Pawn = Cast<APawn>(OtherActor);
	if (Pawn && Pawn->IsPlayerControlled())
	{
		FireNow();
	}
}

void ADerinlikHorrorEventTrigger::FireNow()
{
	UWorld* World = GetWorld();
	if (!World || (bFireOnce && bHasFired))
	{
		return;
	}
	bHasFired = true;
	UE_LOG(LogDerinlik, Log, TEXT("HorrorEvent %s fired (%d steps)."), *GetName(), Steps.Num());

	StepTimers.SetNum(Steps.Num());
	for (int32 Index = 0; Index < Steps.Num(); ++Index)
	{
		if (Steps[Index].Delay <= 0.f)
		{
			// SetTimer with a zero rate clears the timer instead of firing it.
			ExecuteStep(Index);
		}
		else
		{
			World->GetTimerManager().SetTimer(StepTimers[Index],
				FTimerDelegate::CreateUObject(this, &ADerinlikHorrorEventTrigger::ExecuteStep, Index),
				Steps[Index].Delay, false);
		}
	}
}

void ADerinlikHorrorEventTrigger::ResetTrigger()
{
	if (UWorld* World = GetWorld())
	{
		for (FTimerHandle& Handle : StepTimers)
		{
			World->GetTimerManager().ClearTimer(Handle);
		}
	}
	bHasFired = false;
}

void ADerinlikHorrorEventTrigger::ExecuteStep(int32 StepIndex)
{
	if (!Steps.IsValidIndex(StepIndex))
	{
		return;
	}
	const FDerinlikHorrorStep& Step = Steps[StepIndex];

	switch (Step.Action)
	{
	case EDerinlikHorrorAction::CloseDoors:
	case EDerinlikHorrorAction::CloseAndLock:
		for (AActor* Target : Step.Targets)
		{
			if (ADerinlikDoor* Door = Cast<ADerinlikDoor>(Target))
			{
				Door->SetOpen(false);
				if (Step.Action == EDerinlikHorrorAction::CloseAndLock)
				{
					Door->SetLocked(true);
				}
			}
		}
		break;

	case EDerinlikHorrorAction::LightsOff:
	case EDerinlikHorrorAction::LightsOn:
		for (AActor* Target : Step.Targets)
		{
			if (!Target)
			{
				continue;
			}
			TArray<ULightComponent*> Lights;
			Target->GetComponents<ULightComponent>(Lights);
			for (ULightComponent* Light : Lights)
			{
				Light->SetVisibility(Step.Action == EDerinlikHorrorAction::LightsOn);
			}
		}
		break;

	case EDerinlikHorrorAction::PlaySound:
		if (Step.Sound)
		{
			const AActor* Source = Step.Targets.Num() > 0 && Step.Targets[0] ? Step.Targets[0].Get() : this;
			UGameplayStatics::PlaySoundAtLocation(this, Step.Sound, Source->GetActorLocation());
		}
		break;

	case EDerinlikHorrorAction::Custom:
		break;
	}

	if (!Step.CustomTag.IsNone())
	{
		OnCustomStep.Broadcast(Step.CustomTag);
	}
}

#include "Player/DerinlikPlayerController.h"
#include "Derinlik.h"
#include "Player/DerinlikCharacter.h"
#include "UI/DerinlikTextWidget.h"

#include "Camera/PlayerCameraManager.h"
#include "TimerManager.h"

void ADerinlikPlayerController::BeginPlay()
{
	Super::BeginPlay();

	if (!IsLocalController())
	{
		return;
	}
	if (PromptWidgetClass)
	{
		PromptWidget = CreateWidget<UDerinlikTextWidget>(this, PromptWidgetClass);
		if (PromptWidget)
		{
			PromptWidget->AddToViewport(10);
			PromptWidget->SetDisplayText(FText::GetEmpty());
		}
	}
	else
	{
		UE_LOG(LogDerinlik, Warning, TEXT("DerinlikPlayerController: PromptWidgetClass is not set."));
	}
}

void ADerinlikPlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	if (ADerinlikCharacter* DerinlikCharacter = Cast<ADerinlikCharacter>(InPawn))
	{
		DerinlikCharacter->OnFocusChanged.AddUniqueDynamic(this, &ADerinlikPlayerController::HandleFocusChanged);
	}
}

void ADerinlikPlayerController::OnUnPossess()
{
	if (ADerinlikCharacter* DerinlikCharacter = Cast<ADerinlikCharacter>(GetPawn()))
	{
		DerinlikCharacter->OnFocusChanged.RemoveDynamic(this, &ADerinlikPlayerController::HandleFocusChanged);
	}
	Super::OnUnPossess();
}

void ADerinlikPlayerController::HandleFocusChanged(AActor* NewFocus, FText Prompt)
{
	if (PromptWidget && !bChapterEnding)
	{
		PromptWidget->SetDisplayText(NewFocus ? Prompt : FText::GetEmpty());
	}
}

void ADerinlikPlayerController::PlayChapterEnd(FText Title, float FadeSeconds)
{
	if (bChapterEnding)
	{
		return;
	}
	bChapterEnding = true;

	if (PromptWidget)
	{
		PromptWidget->SetDisplayText(FText::GetEmpty());
	}
	if (APawn* ControlledPawn = GetPawn())
	{
		ControlledPawn->DisableInput(this);
	}
	if (PlayerCameraManager)
	{
		PlayerCameraManager->StartCameraFade(0.f, 1.f, FadeSeconds, FLinearColor::Black, true, true);
	}

	const float Delay = FMath::Max(FadeSeconds, 0.01f);
	GetWorldTimerManager().SetTimer(ChapterTitleTimer,
		FTimerDelegate::CreateUObject(this, &ADerinlikPlayerController::ShowChapterTitle, Title), Delay, false);
}

void ADerinlikPlayerController::ShowChapterTitle(FText Title)
{
	if (ChapterTitleWidgetClass && !ChapterTitleWidget)
	{
		ChapterTitleWidget = CreateWidget<UDerinlikTextWidget>(this, ChapterTitleWidgetClass);
		if (ChapterTitleWidget)
		{
			ChapterTitleWidget->AddToViewport(100);
		}
	}
	if (ChapterTitleWidget)
	{
		ChapterTitleWidget->SetDisplayText(Title);
	}
	OnChapterEnded.Broadcast();
}

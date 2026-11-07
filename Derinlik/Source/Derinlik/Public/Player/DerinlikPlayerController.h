#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "DerinlikPlayerController.generated.h"

class UDerinlikTextWidget;

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnChapterEnded);

/** Owns the on-screen UI (interaction prompt, chapter title card) and the chapter-end sequence. */
UCLASS()
class DERINLIK_API ADerinlikPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	/** Fades to black, locks input and shows the chapter title. Safe to call once per chapter. */
	UFUNCTION(BlueprintCallable, Category = "Derinlik|Chapter")
	void PlayChapterEnd(FText Title, float FadeSeconds = 2.5f);

	UPROPERTY(BlueprintAssignable, Category = "Derinlik|Chapter")
	FOnChapterEnded OnChapterEnded;

protected:
	virtual void BeginPlay() override;
	virtual void OnPossess(APawn* InPawn) override;
	virtual void OnUnPossess() override;

	/** WBP_InteractionPrompt (parent: DerinlikTextWidget). */
	UPROPERTY(EditDefaultsOnly, Category = "Derinlik|UI")
	TSubclassOf<UDerinlikTextWidget> PromptWidgetClass;

	/** WBP_ChapterTitle (parent: DerinlikTextWidget). */
	UPROPERTY(EditDefaultsOnly, Category = "Derinlik|UI")
	TSubclassOf<UDerinlikTextWidget> ChapterTitleWidgetClass;

private:
	UFUNCTION()
	void HandleFocusChanged(AActor* NewFocus, FText Prompt);

	void ShowChapterTitle(FText Title);

	UPROPERTY(Transient)
	TObjectPtr<UDerinlikTextWidget> PromptWidget;

	UPROPERTY(Transient)
	TObjectPtr<UDerinlikTextWidget> ChapterTitleWidget;

	bool bChapterEnding = false;
	FTimerHandle ChapterTitleTimer;
};

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "DerinlikTextWidget.generated.h"

class UTextBlock;

/**
 * Minimal text widget used for the interaction prompt and the chapter title card.
 * Create a Widget Blueprint with this as parent and add a TextBlock named "MainText".
 */
UCLASS(Abstract)
class DERINLIK_API UDerinlikTextWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	/** Sets the text and collapses the widget when the text is empty. */
	UFUNCTION(BlueprintCallable, Category = "Derinlik|UI")
	void SetDisplayText(const FText& InText);

protected:
	UPROPERTY(meta = (BindWidget))
	TObjectPtr<UTextBlock> MainText;
};

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "DerinlikCamcorderOverlayWidget.generated.h"

class UTextBlock;

/**
 * Camcorder viewfinder overlay (REC dot, frame corners, timecode).
 * Parent of WBP_CamcorderOverlay; an optional TextBlock named "TimecodeText" shows REC time.
 */
UCLASS(Abstract)
class DERINLIK_API UDerinlikCamcorderOverlayWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	/** Called by the camcorder each time it is raised. */
	void ResetTimecode() { ElapsedSeconds = 0.f; LastShownSecond = -1; }

protected:
	virtual void NativeTick(const FGeometry& MyGeometry, float InDeltaTime) override;

	UPROPERTY(meta = (BindWidgetOptional))
	TObjectPtr<UTextBlock> TimecodeText;

private:
	float ElapsedSeconds = 0.f;
	int32 LastShownSecond = -1;
};

#include "UI/DerinlikCamcorderOverlayWidget.h"
#include "Components/TextBlock.h"

void UDerinlikCamcorderOverlayWidget::NativeTick(const FGeometry& MyGeometry, float InDeltaTime)
{
	Super::NativeTick(MyGeometry, InDeltaTime);

	ElapsedSeconds += InDeltaTime;
	const int32 Total = FMath::FloorToInt(ElapsedSeconds);
	if (TimecodeText && Total != LastShownSecond)
	{
		LastShownSecond = Total;
		TimecodeText->SetText(FText::FromString(
			FString::Printf(TEXT("REC  %02d:%02d:%02d"), Total / 3600, (Total / 60) % 60, Total % 60)));
	}
}

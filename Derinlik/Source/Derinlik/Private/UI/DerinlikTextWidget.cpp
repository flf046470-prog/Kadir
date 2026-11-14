#include "UI/DerinlikTextWidget.h"
#include "Components/TextBlock.h"

void UDerinlikTextWidget::SetDisplayText(const FText& InText)
{
	if (MainText)
	{
		MainText->SetText(InText);
	}
	SetVisibility(InText.IsEmpty() ? ESlateVisibility::Collapsed : ESlateVisibility::HitTestInvisible);
}

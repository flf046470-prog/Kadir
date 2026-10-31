#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "DerinlikHiddenSymbol.generated.h"

class UBoxComponent;
class UDecalComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnHiddenSymbolActivated);

/**
 * A First Recorders' symbol that is invisible to the naked eye and only shows through the camcorder.
 * Holding it in frame for RequiredDwellSeconds activates it; on activation it slides the linked
 * actors (e.g. a stone slab) by MoveOffset, and fires OnActivated for anything else.
 */
UCLASS()
class DERINLIK_API ADerinlikHiddenSymbol : public AActor
{
	GENERATED_BODY()

public:
	ADerinlikHiddenSymbol();

	virtual void Tick(float DeltaSeconds) override;

	void SetRevealed(bool bRevealed);

	UFUNCTION(BlueprintCallable, Category = "Symbol")
	void Activate();

	UFUNCTION(BlueprintPure, Category = "Symbol")
	bool IsActivated() const { return bActivated; }

	float GetRequiredDwellSeconds() const { return RequiredDwellSeconds; }

	UPROPERTY(BlueprintAssignable, Category = "Symbol")
	FOnHiddenSymbolActivated OnActivated;

protected:
	virtual void BeginPlay() override;

	/** Thin box in front of the wall so the camcorder trace can hit the symbol. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Symbol")
	TObjectPtr<UBoxComponent> TraceVolume;

	/** Assign an emissive decal material (the symbol). Hidden unless the camcorder is raised. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Symbol")
	TObjectPtr<UDecalComponent> SymbolDecal;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Symbol", meta = (ClampMin = "0.1"))
	float RequiredDwellSeconds = 2.f;

	/** Actors moved when the symbol activates (place the stone slab here). */
	UPROPERTY(EditInstanceOnly, BlueprintReadWrite, Category = "Symbol|Reveal")
	TArray<TObjectPtr<AActor>> LinkedActors;

	/** World-space offset applied to every linked actor, e.g. (0,0,-220) sinks a slab into the floor. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Symbol|Reveal")
	FVector MoveOffset = FVector(0.f, 0.f, -220.f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Symbol|Reveal", meta = (ClampMin = "0.1"))
	float MoveDuration = 4.f;

	/** Keep the symbol visible to the naked eye once activated (it has "woken up"). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Symbol")
	bool bStayVisibleAfterActivation = true;

private:
	UPROPERTY(SaveGame)
	bool bActivated = false;

	TArray<FVector> MoveStartLocations;
	float MoveElapsed = 0.f;
};

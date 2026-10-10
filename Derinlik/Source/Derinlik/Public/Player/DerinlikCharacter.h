#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "DerinlikCharacter.generated.h"

class UCameraComponent;
class USpotLightComponent;
class UInputAction;
class UInputMappingContext;
struct FInputActionValue;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnFocusChanged, AActor*, NewFocus, FText, Prompt);

/**
 * First-person player for DERINLIK (Ekin Yalin).
 * Phase 1 scope: walk / sprint / crouch, subtle head bob, flashlight, interaction trace.
 * Camcorder, Echo level and inventory live in separate components (later tasks).
 */
UCLASS()
class DERINLIK_API ADerinlikCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ADerinlikCharacter();

	virtual void Tick(float DeltaSeconds) override;
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;

	UFUNCTION(BlueprintCallable, Category = "Flashlight")
	void SetFlashlightOn(bool bOn);

	UFUNCTION(BlueprintPure, Category = "Flashlight")
	bool IsFlashlightOn() const;

	/** Fired when the interactable under the crosshair changes (nullptr = nothing). Bind the HUD prompt to this. */
	UPROPERTY(BlueprintAssignable, Category = "Interaction")
	FOnFocusChanged OnFocusChanged;

	/** Comfort setting, 0 = no head bob. Driven by the settings menu later. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Comfort", meta = (ClampMin = "0", ClampMax = "1"))
	float HeadBobScale = 1.f;

protected:
	virtual void BeginPlay() override;

	// --- Components ---
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UCameraComponent> FirstPersonCamera;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<USpotLightComponent> Flashlight;

	// --- Input (assign the assets in BP_DerinlikCharacter) ---
	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputMappingContext> DefaultMappingContext;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> SprintAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> CrouchAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> FlashlightAction;

	UPROPERTY(EditDefaultsOnly, Category = "Input")
	TObjectPtr<UInputAction> InteractAction;

	// --- Movement tuning (cm/s) ---
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Movement")
	float WalkSpeed = 190.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Movement")
	float SprintSpeed = 380.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Movement")
	float CrouchSpeed = 110.f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	float InteractionDistance = 220.f;

	UPROPERTY(EditAnywhere, Category = "Camera")
	float EyeHeight = 64.f;

	UPROPERTY(EditAnywhere, Category = "Camera")
	float CrouchedEyeHeight = 40.f;

	UPROPERTY(EditAnywhere, Category = "Camera")
	float HeadBobAmplitude = 1.2f;

	UPROPERTY(EditAnywhere, Category = "Camera")
	float HeadBobFrequency = 1.8f;

private:
	void Move(const FInputActionValue& Value);
	void Look(const FInputActionValue& Value);
	void StartSprint();
	void StopSprint();
	void ToggleCrouch();
	void ToggleFlashlight();
	void Interact();

	void UpdateFocus();
	void UpdateHeadBob(float DeltaSeconds);

	UPROPERTY(Transient)
	TWeakObjectPtr<AActor> FocusedActor;

	bool bWantsSprint = false;
	float BobTime = 0.f;
};

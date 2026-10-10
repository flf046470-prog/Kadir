#include "Player/DerinlikCharacter.h"
#include "Derinlik.h"
#include "Interaction/DerinlikInteractable.h"
#include "Camcorder/DerinlikCamcorderComponent.h"

#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/SpotLightComponent.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "InputActionValue.h"

ADerinlikCharacter::ADerinlikCharacter()
{
	PrimaryActorTick.bCanEverTick = true;

	GetCapsuleComponent()->InitCapsuleSize(34.f, 88.f);

	FirstPersonCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FirstPersonCamera"));
	FirstPersonCamera->SetupAttachment(GetCapsuleComponent());
	FirstPersonCamera->SetRelativeLocation(FVector(0.f, 0.f, EyeHeight));
	FirstPersonCamera->bUsePawnControlRotation = true;
	FirstPersonCamera->SetFieldOfView(85.f);

	Flashlight = CreateDefaultSubobject<USpotLightComponent>(TEXT("Flashlight"));
	Flashlight->SetupAttachment(FirstPersonCamera);
	Flashlight->SetRelativeLocation(FVector(10.f, 12.f, -12.f));
	Flashlight->SetIntensityUnits(ELightUnits::Lumens);
	Flashlight->SetIntensity(450.f);
	Flashlight->SetAttenuationRadius(1600.f);
	Flashlight->SetInnerConeAngle(12.f);
	Flashlight->SetOuterConeAngle(28.f);
	Flashlight->SetCastShadows(true);
	Flashlight->SetVisibility(false);

	Camcorder = CreateDefaultSubobject<UDerinlikCamcorderComponent>(TEXT("Camcorder"));

	UCharacterMovementComponent* MoveComp = GetCharacterMovement();
	MoveComp->MaxWalkSpeed = WalkSpeed;
	MoveComp->MaxWalkSpeedCrouched = CrouchSpeed;
	MoveComp->NavAgentProps.bCanCrouch = true;
	MoveComp->SetCrouchedHalfHeight(52.f);
	MoveComp->BrakingDecelerationWalking = 1400.f;

	bUseControllerRotationYaw = true;
}

void ADerinlikCharacter::BeginPlay()
{
	Super::BeginPlay();

	GetCharacterMovement()->MaxWalkSpeed = WalkSpeed;
	GetCharacterMovement()->MaxWalkSpeedCrouched = CrouchSpeed;

	if (const APlayerController* PC = Cast<APlayerController>(GetController()))
	{
		if (UEnhancedInputLocalPlayerSubsystem* Subsystem =
			ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer()))
		{
			if (DefaultMappingContext)
			{
				Subsystem->AddMappingContext(DefaultMappingContext, 0);
			}
			else
			{
				UE_LOG(LogDerinlik, Warning, TEXT("DerinlikCharacter: DefaultMappingContext is not set."));
			}
		}
	}
}

void ADerinlikCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);

	UEnhancedInputComponent* Input = Cast<UEnhancedInputComponent>(PlayerInputComponent);
	if (!Input)
	{
		UE_LOG(LogDerinlik, Error, TEXT("DerinlikCharacter requires EnhancedInputComponent (check DefaultInput.ini)."));
		return;
	}

	if (MoveAction)       Input->BindAction(MoveAction, ETriggerEvent::Triggered, this, &ADerinlikCharacter::Move);
	if (LookAction)       Input->BindAction(LookAction, ETriggerEvent::Triggered, this, &ADerinlikCharacter::Look);
	if (SprintAction)
	{
		Input->BindAction(SprintAction, ETriggerEvent::Started, this, &ADerinlikCharacter::StartSprint);
		Input->BindAction(SprintAction, ETriggerEvent::Completed, this, &ADerinlikCharacter::StopSprint);
	}
	if (CrouchAction)     Input->BindAction(CrouchAction, ETriggerEvent::Started, this, &ADerinlikCharacter::ToggleCrouch);
	if (FlashlightAction) Input->BindAction(FlashlightAction, ETriggerEvent::Started, this, &ADerinlikCharacter::ToggleFlashlight);
	if (InteractAction)   Input->BindAction(InteractAction, ETriggerEvent::Started, this, &ADerinlikCharacter::Interact);
	if (CamcorderAction)  Input->BindAction(CamcorderAction, ETriggerEvent::Started, this, &ADerinlikCharacter::ToggleCamcorder);
}

void ADerinlikCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Sprint only while moving forward-ish and standing; keeps exploration deliberate.
	const bool bCanSprint = bWantsSprint && !bIsCrouched && GetVelocity().Size2D() > 10.f;
	GetCharacterMovement()->MaxWalkSpeed = bCanSprint ? SprintSpeed : WalkSpeed;

	UpdateFocus();
	UpdateHeadBob(DeltaSeconds);
}

void ADerinlikCharacter::Move(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddMovementInput(GetActorForwardVector(), Axis.Y);
	AddMovementInput(GetActorRightVector(), Axis.X);
}

void ADerinlikCharacter::Look(const FInputActionValue& Value)
{
	const FVector2D Axis = Value.Get<FVector2D>();
	AddControllerYawInput(Axis.X);
	AddControllerPitchInput(Axis.Y);
}

void ADerinlikCharacter::StartSprint() { bWantsSprint = true; }
void ADerinlikCharacter::StopSprint()  { bWantsSprint = false; }

void ADerinlikCharacter::ToggleCrouch()
{
	if (bIsCrouched) { UnCrouch(); } else { Crouch(); }
}

void ADerinlikCharacter::ToggleFlashlight()
{
	SetFlashlightOn(!IsFlashlightOn());
}

void ADerinlikCharacter::ToggleCamcorder()
{
	Camcorder->ToggleRaised();
}

void ADerinlikCharacter::SetFlashlightOn(bool bOn)
{
	Flashlight->SetVisibility(bOn);
}

bool ADerinlikCharacter::IsFlashlightOn() const
{
	return Flashlight->IsVisible();
}

void ADerinlikCharacter::UpdateFocus()
{
	const FVector Start = FirstPersonCamera->GetComponentLocation();
	const FVector End = Start + FirstPersonCamera->GetForwardVector() * InteractionDistance;

	FCollisionQueryParams Params(SCENE_QUERY_STAT(DerinlikInteract), false, this);
	FHitResult Hit;
	AActor* NewFocus = nullptr;
	if (GetWorld()->LineTraceSingleByChannel(Hit, Start, End, ECC_Visibility, Params))
	{
		AActor* HitActor = Hit.GetActor();
		if (HitActor && HitActor->Implements<UDerinlikInteractable>()
			&& IDerinlikInteractable::Execute_CanInteract(HitActor, this))
		{
			NewFocus = HitActor;
		}
	}

	if (NewFocus != FocusedActor.Get())
	{
		FocusedActor = NewFocus;
		const FText Prompt = NewFocus ? IDerinlikInteractable::Execute_GetInteractionPrompt(NewFocus) : FText::GetEmpty();
		OnFocusChanged.Broadcast(NewFocus, Prompt);
	}
}

void ADerinlikCharacter::Interact()
{
	if (AActor* Target = FocusedActor.Get())
	{
		IDerinlikInteractable::Execute_Interact(Target, this);
		// Prompt may change (Open -> Close); re-broadcast.
		OnFocusChanged.Broadcast(Target, IDerinlikInteractable::Execute_GetInteractionPrompt(Target));
	}
}

void ADerinlikCharacter::UpdateHeadBob(float DeltaSeconds)
{
	const float Speed = GetVelocity().Size2D();
	const bool bGrounded = GetCharacterMovement()->IsMovingOnGround();
	// The capsule itself shrinks when crouched, so this is relative to the (lower) capsule centre.
	const float BaseZ = bIsCrouched ? CrouchedEyeHeight : EyeHeight;

	float Offset = 0.f;
	if (bGrounded && Speed > 10.f && HeadBobScale > 0.f)
	{
		BobTime += DeltaSeconds * HeadBobFrequency * (Speed / WalkSpeed) * UE_TWO_PI;
		Offset = FMath::Sin(BobTime) * HeadBobAmplitude * HeadBobScale;
	}
	else
	{
		BobTime = 0.f;
	}

	FVector Loc = FirstPersonCamera->GetRelativeLocation();
	Loc.Z = FMath::FInterpTo(Loc.Z, BaseZ + Offset, DeltaSeconds, 10.f);
	FirstPersonCamera->SetRelativeLocation(Loc);
}

from typing import Union
from diffusers import FlowMatchEulerDiscreteScheduler
import torch
from toolkit.timestep_weighing.default_weighing_scheme import default_weighing_scheme

from dataclasses import dataclass
from typing import Optional, Tuple
from diffusers.utils import BaseOutput


@dataclass
class FlowMatchEulerDiscreteSchedulerOutput(BaseOutput):
    """
    Output class for the scheduler's `step` function output.

    Args:
        prev_sample (`torch.FloatTensor` of shape `(batch_size, num_channels, height, width)` for images):
            Computed sample `(x_{t-1})` of previous timestep. `prev_sample` should be used as next model input in the
            denoising loop.
    """

    prev_sample: torch.FloatTensor


class MeanFlowScheduler(FlowMatchEulerDiscreteScheduler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.init_noise_sigma = 1.0
        self.timestep_type = "linear"

        with torch.no_grad():
            # create weights for timesteps
            num_timesteps = 1000

            # Create linear timesteps from 1000 to 1
            timesteps = torch.linspace(1000, 1, num_timesteps, device="cpu")

            # Low-t-emphasizing weighing curve, mirrors the one in
            # CustomFlowMatchEulerDiscreteScheduler. Step index 0 corresponds
            # to t=1000 (noisy) and step index N-1 to t=1 (clean); the
            # Gaussian is centered at x=N so the peak sits at the low-t end.
            x = torch.arange(num_timesteps, dtype=torch.float32)
            y_low = torch.exp(-2 * ((x - num_timesteps) / num_timesteps) ** 2)
            y_low_shifted = y_low - y_low.min()
            low_t_weighing = y_low_shifted * (num_timesteps / y_low_shifted.sum())

            self.linear_timesteps = timesteps
            self.low_t_weighing = low_t_weighing
            pass

    def get_weights_for_timesteps(
        self, timesteps: torch.Tensor, v2=False, timestep_type="linear"
    ) -> torch.Tensor:
        # Get the indices of the timesteps
        step_indices = [(self.timesteps == t).nonzero().item() for t in timesteps]

        weights = 1.0

        # Get the weights for the timesteps
        if timestep_type == "weighted":
            weights = torch.tensor(
                [default_weighing_scheme[i] for i in step_indices],
                device=timesteps.device,
                dtype=timesteps.dtype,
            )
        elif timestep_type == "weighted_low":
            weights = self.low_t_weighing[step_indices].flatten().to(
                device=timesteps.device, dtype=timesteps.dtype,
            )
        elif timestep_type == "custom" and getattr(self, "custom_curve_weights", None) is not None:
            weights = self.custom_curve_weights[step_indices].flatten().to(
                device=timesteps.device, dtype=timesteps.dtype,
            )

        return weights

    def add_noise(
        self,
        original_samples: torch.Tensor,
        noise: torch.Tensor,
        timesteps: torch.Tensor,
    ) -> torch.Tensor:
        t_01 = (timesteps / 1000).to(original_samples.device)
        noisy_model_input = (1.0 - t_01) * original_samples + t_01 * noise
        return noisy_model_input

    def scale_model_input(
        self, sample: torch.Tensor, timestep: Union[float, torch.Tensor]
    ) -> torch.Tensor:
        return sample

    def set_train_timesteps(self, num_timesteps, device, **kwargs):
        timestep_type = kwargs.get('timestep_type', 'linear')
        custom_curve = kwargs.get('custom_curve', None)
        if timestep_type == 'custom':
            from toolkit.timestep_weighing.custom_curve import resolve_curve_weights, resolve_live_curve
            live_curve = resolve_live_curve(custom_curve, 'weighting')
            cached_for = getattr(self, "_custom_curve_resolved_for", None)
            if cached_for is not live_curve or getattr(self, "custom_curve_weights", None) is None:
                self.custom_curve_weights = resolve_curve_weights(live_curve, num_timesteps).to(device)
                self._custom_curve_resolved_for = live_curve
        timesteps = torch.linspace(1000, 1, num_timesteps, device=device)
        self.timesteps = timesteps
        return timesteps

    def step(
        self,
        model_output: torch.FloatTensor,
        timestep: Union[float, torch.FloatTensor],
        sample: torch.FloatTensor,
        return_dict: bool = True,
        **kwargs: Optional[dict],
    ) -> Union[FlowMatchEulerDiscreteSchedulerOutput, Tuple]:

        # single euler step (Eq. 5 ⇒ x₀ = x₁ − uθ)
        output = sample - model_output
        if not return_dict:
            return (output,)

        return FlowMatchEulerDiscreteSchedulerOutput(prev_sample=output)

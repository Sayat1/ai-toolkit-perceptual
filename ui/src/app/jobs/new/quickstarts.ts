// Quickstart templates pre-load a known-good job config into the new-job form.
// Each template's `apply()` returns a fresh JobConfig, preserving a few
// already-filled user-side fields (training name, dataset folder_path) so the
// template can be applied mid-flow without nuking work the user has already done.

import { JobConfig } from '@/types';

export interface QuickstartTemplate {
  id: string;
  label: string;
  description: string;
  /** Produce a new JobConfig from the template. Receives the current form
   *  state so it can preserve user-entered fields like name and folder_path. */
  apply: (current: JobConfig) => JobConfig;
}

// ---------------------------------------------------------------------------
// Subject Likeness — Flux 2 Klein 9B + Weight Noise
// ---------------------------------------------------------------------------
// Abstracted from a validated production run that empirically produced strong
// subject likeness on Flux 2 Klein 9B using weight noise + LoKr + multi-bucket
// resolutions + depth-consistency + subject masking. Specifics that vary per
// user (dataset path, training name, sample prompt, model checkpoint) are
// abstracted; everything else encodes the technique.

const subjectLikenessFlux2Klein9b: QuickstartTemplate = {
  id: 'subject_likeness_flux2_klein9b',
  label: 'Subject Likeness (Flux 2 Klein 9B + Weight Noise)',
  description:
    'LoKr + weight noise (relative σ=0.0125) on Flux 2 Klein 9B. Single dataset ' +
    'with 512/768/1024 buckets at 16:4:1 num_repeats, depth-consistency + ' +
    'subject masking, AdamW8bit @ lr=5e-5, batch=4, 1200 steps.',
  apply: (current) => {
    // Preserve user-entered fields if they exist; otherwise fall back to
    // sensible blanks so the form clearly shows what still needs filling in.
    const existingName = current.config.name || '';
    const existingDatasetPath =
      current.config.process[0]?.datasets?.[0]?.folder_path || '';
    const existingGpuIds = (current.config.process[0] as any)?.gpu_ids;

    // Single dataset entry covering all three buckets via the per-resolution
    // num_repeats list form (preprocess_dataset_raw_config expands this into
    // one internal dataset per resolution). 16:4:1 ratio biases learning
    // toward 512 while still seeing 768 and 1024 to anchor higher-res quality.
    const dataset = {
      folder_path: existingDatasetPath,
      mask_path: null,
      mask_min_value: 0.1,
      default_caption: '',
      caption_ext: 'txt',
      caption_dropout_rate: 0.05,
      cache_latents_to_disk: true,
      is_reg: false,
      network_weight: 1,
      resolution: [512, 768, 1024],
      controls: [],
      shrink_video_to_frames: true,
      num_frames: 1,
      flip_x: false,
      flip_y: false,
      num_repeats: [16, 4, 1],
      diffusion_loss_weight: 1,
      depth_loss_weight: 0.005,
      loss_split: 'sum',
    };

    return {
      job: 'extension',
      config: {
        name: existingName,
        process: [
          {
            type: 'diffusion_trainer',
            training_folder: '/home/z/Documents/repos/ai-toolkit/output',
            sqlite_db_path: './aitk_db.db',
            device: 'cuda',
            trigger_word: null,
            performance_log_every: 10,
            network: {
              type: 'lokr',
              linear: 32,
              linear_alpha: 32,
              conv: 16,
              conv_alpha: 16,
              lokr_full_rank: true,
              lokr_factor: 8,
              network_kwargs: { ignore_if_contains: [] },
            },
            save: {
              dtype: 'bf16',
              save_every: 25,
              max_step_saves_to_keep: 120,
              save_format: 'diffusers',
              push_to_hub: false,
            },
            datasets: [dataset],
            train: {
              weight_noise: {
                enabled: true,
                mode: 'relative',
                sigma: 0.0125,
                log_every: 1,
              },
              max_grad_norm: 1,
              batch_size: 4,
              bypass_guidance_embedding: false,
              steps: 1200,
              gradient_accumulation: 1,
              train_unet: true,
              train_text_encoder: false,
              gradient_checkpointing: true,
              noise_scheduler: 'flowmatch',
              optimizer: 'adamw8bit',
              timestep_type: 'linear',
              content_or_style: 'balanced',
              optimizer_params: { weight_decay: 0.0001 },
              unload_text_encoder: false,
              cache_text_embeddings: true,
              lr: 5e-5,
              ema_config: { use_ema: false, ema_decay: 0.99 },
              skip_first_sample: false,
              force_first_sample: true,
              disable_sampling: false,
              dtype: 'bf16',
              diff_output_preservation: false,
              diff_output_preservation_multiplier: 1,
              diff_output_preservation_class: 'person',
              switch_boundary_every: 1,
              loss_type: 'mse',
              diffusion_loss_weight: 1,
              diffusion_loss_max_t: 1,
              diffusion_loss_min_t: 0,
              custom_timestep_distribution: null,
              custom_timestep_curve: null,
              max_denoising_steps: 999,
              min_denoising_steps: 0,
              loss_split: null,
            },
            logging: { log_every: 1, use_ui_logger: true },
            model: {
              // Default to the HuggingFace Flux 2 Klein 9B release; user can
              // swap this for a local checkpoint after applying the template.
              name_or_path: 'black-forest-labs/FLUX.2-klein-base-9B',
              quantize: true,
              qtype: 'qfloat8',
              quantize_te: true,
              qtype_te: 'qfloat8',
              arch: 'flux2_klein_9b',
              low_vram: false,
              model_kwargs: { match_target_res: false },
              layer_offloading: false,
              layer_offloading_text_encoder_percent: 1,
              layer_offloading_transformer_percent: 1,
            },
            sample: {
              sampler: 'flowmatch',
              sample_every: 100,
              width: 640,
              height: 960,
              samples: [
                { prompt: 'a photo of a person' },
              ],
              neg: '',
              seed: 42,
              walk_seed: false,
              guidance_scale: 4,
              sample_steps: 25,
              num_frames: 1,
              fps: 1,
            },
            face_id: {
              enabled: false,
              init_scale: 0.3,
              identity_loss_weight: 0,
              landmark_loss_weight: 0,
              body_proportion_loss_weight: 0,
              body_proportion_loss_min_t: 0.8,
              body_proportion_loss_max_t: 1,
              body_shape_loss_weight: 0,
              body_shape_loss_max_t: 1,
              body_shape_loss_min_t: 0.8,
              identity_loss_min_t: 0,
              identity_loss_max_t: 0.9,
              identity_metrics: false,
              identity_loss_use_average: true,
              identity_loss_min_cos: 0.4,
            },
            depth_consistency: {
              loss_weight: 0.005,
              input_size: 518,
              preview_every: 1,
              mask_source: 'subject',
              loss_max_t: 1,
              model_id: 'depth-anything/Depth-Anything-V2-Large-hf',
              loss_min_t: 0,
              grad_checkpoint: false,
              ssi_weight: 0,
              grad_weight: 1,
              grad_scales: 6,
            },
            subject_mask: {
              enabled: true,
              background_loss_weight: 0,
              clothing_loss_weight: 1,
              save_debug_previews: true,
              cache_resolution: 768,
              segformer_res: 768,
            },
            ...(existingGpuIds !== undefined ? { gpu_ids: existingGpuIds } : {}),
          } as any,
        ],
      },
      meta: { name: '[name]', version: '1.0' },
    } as unknown as JobConfig;
  },
};

export const QUICKSTARTS: QuickstartTemplate[] = [subjectLikenessFlux2Klein9b];

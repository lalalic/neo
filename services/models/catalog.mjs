/** The Codex backend catalog is NOT the OpenAI public /v1/models schema.
 * Codex advertises client_version when fetching the richer provider catalog.
 * Preserve normal OpenAI model discovery for clients without that parameter.
 */
const openAIModels=Object.freeze({
  object:'list',data:[{id:'neo',object:'model',owned_by:'neo'}]
});
const codexModels=Object.freeze({
  models:[{
    slug:'neo',display_name:'Neo',
    description:'Stateful ChatGPT agent through the Neo model gateway',
    // Codex 0.165.0 requires base_instructions OR
    // model_messages.instructions_template in each catalog entry.
    // This is generic transport guidance, never a ToyAlive agent prompt.
    base_instructions:'Follow the supplied system, developer and user instructions, using your available connected tools when necessary.',
    default_reasoning_level:null,supported_reasoning_levels:[],
    // ChatGPT executes its own connected tools; no Codex function-call loop.
    shell_type:'disabled',visibility:'list',supported_in_api:true,priority:0,
    additional_speed_tiers:[],service_tiers:[],
    availability_nux:null,upgrade:null,model_messages:null,
    include_skills_usage_instructions:false,
    include_plugin_usage_instructions:false,
    include_apps_usage_instructions:false,
    default_reasoning_summary:'auto',
    support_verbosity:false,default_verbosity:null,
    apply_patch_tool_type:null,web_search_tool_type:'text',
    truncation_policy:{mode:'bytes',limit:10000},
    supports_image_detail_original:false,
    // Conservative virtual-model hints, not a claim about the browser model's
    // full context capacity. The gateway bounds actual request bytes separately.
    context_window:131072,max_context_window:131072,
    effective_context_window_percent:95,
    experimental_supported_tools:[],input_modalities:['text','image'],
    supports_search_tool:false,supports_experimental_context:false,
    use_responses_lite:false,node_repl_auto_review_required:false,
    node_repl_disabled:true,max_output_tokens:8192
  }]
});
export function listModelCatalog(params){
  return params?.has('client_version')?codexModels:openAIModels;
}

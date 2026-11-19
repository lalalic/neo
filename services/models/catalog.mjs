/** The Codex backend catalog is NOT the OpenAI public /v1/models schema.
 * Codex advertises client_version when fetching the richer provider catalog.
 * Preserve normal OpenAI model discovery for clients without that parameter.
 */
const modelSpecs=[
  {id:'chatgpt',display:'ChatGPT',description:'ChatGPT browser via Neo Gateway and Events Bus',modalities:['text','image']},
  {id:'z',display:'Z.ai',description:'chat.z.ai browser via Neo Gateway and verified webpage completion',modalities:['text']},
];
const openAIModels=Object.freeze({object:'list',data:modelSpecs.map(m=>({id:m.id,object:'model',owned_by:'neo'}))});
const codexModels=Object.freeze({models:modelSpecs.map((m,i)=>({
  slug:m.id,display_name:m.display,description:m.description,
  base_instructions:'Follow the supplied system, developer and user instructions, using your available connected tools when necessary.',
  default_reasoning_level:null,supported_reasoning_levels:[],
  shell_type:'disabled',visibility:'list',supported_in_api:true,priority:i,
  additional_speed_tiers:[],service_tiers:[],availability_nux:null,upgrade:null,model_messages:null,
  include_skills_usage_instructions:false,include_plugin_usage_instructions:false,
  include_apps_usage_instructions:false,default_reasoning_summary:'auto',
  support_verbosity:false,default_verbosity:null,apply_patch_tool_type:null,
  web_search_tool_type:'text',truncation_policy:{mode:'bytes',limit:10000},
  supports_image_detail_original:false,context_window:131072,max_context_window:131072,
  effective_context_window_percent:95,experimental_supported_tools:[],input_modalities:m.modalities,
  supports_search_tool:false,supports_experimental_context:false,use_responses_lite:false,
  node_repl_auto_review_required:false,node_repl_disabled:true,max_output_tokens:8192,
}))});
// Keep `neo` usable by existing clients, but expose only the two selectable models.
export const canonicalModel=id=>id==='neo'?'chatgpt':id;
export const isModelSupported=id=>['chatgpt','z','neo'].includes(id);

export function listModelCatalog(params){
  return params?.has('client_version')?codexModels:openAIModels;
}

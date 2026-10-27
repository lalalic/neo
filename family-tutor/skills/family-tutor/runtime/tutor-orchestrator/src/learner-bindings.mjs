export function requireConfiguredLearners(children,status){
  const bindings=new Map((status?.bindings||[]).map(binding=>[binding.learner,binding]));
  return children.map(child=>{
    const binding=bindings.get(child.id);
    if(!binding?.project_id||!binding?.thread_id){
      throw new Error(`Configured ChatGPT Project/thread binding is missing for learner ${child.id}`);
    }
    return binding;
  });
}

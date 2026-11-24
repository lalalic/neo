// CUDA driver API smoke probe: execute PTX on a real GPU, without CUDA Toolkit.
// The NVIDIA host/container runtime provides libcuda.so.1 at execution time.
#define _POSIX_C_SOURCE 200809L
#include <dlfcn.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef int CUresult;
typedef int CUdevice;
typedef struct CUctx_st *CUcontext;
typedef struct CUmod_st *CUmodule;
typedef struct CUfunc_st *CUfunction;
typedef uint64_t CUdeviceptr;

static const char ptx[] =
  ".version 6.0\n"
  ".target sm_50\n"
  ".address_size 64\n"
  ".visible .entry hello_neo(.param .u64 output) {\n"
  "  .reg .b64 %rd<2>;\n"
  "  .reg .b32 %r<3>;\n"
  "  ld.param.u64 %rd1, [output];\n"
  "  mov.u32 %r1, 40;\n"
  "  mov.u32 %r2, 2;\n"
  "  add.u32 %r1, %r1, %r2;\n"
  "  st.global.u32 [%rd1], %r1;\n"
  "  ret;\n"
  "}\n";

int main(void) {
  void *lib = dlopen("libcuda.so.1", RTLD_NOW | RTLD_LOCAL);
  if (!lib) { fprintf(stderr,"HELLO_NEO_CUDA_FAIL: no NVIDIA driver library\n"); return 2; }
  CUresult (*p_cuInit)(unsigned int) = NULL;
  CUresult (*p_cuDeviceGetCount)(int *) = NULL;
  CUresult (*p_cuDeviceGet)(CUdevice *,int) = NULL;
  CUresult (*p_cuDeviceGetName)(char *,int,CUdevice) = NULL;
  CUresult (*p_cuCtxCreate_v2)(CUcontext *,unsigned int,CUdevice) = NULL;
  CUresult (*p_cuCtxDestroy_v2)(CUcontext) = NULL;
  CUresult (*p_cuModuleLoadData)(CUmodule *,const void *) = NULL;
  CUresult (*p_cuModuleGetFunction)(CUfunction *,CUmodule,const char *) = NULL;
  CUresult (*p_cuModuleUnload)(CUmodule) = NULL;
  CUresult (*p_cuMemAlloc_v2)(CUdeviceptr *,size_t) = NULL;
  CUresult (*p_cuMemFree_v2)(CUdeviceptr) = NULL;
  CUresult (*p_cuMemcpyDtoH_v2)(void *,CUdeviceptr,size_t) = NULL;
  CUresult (*p_cuLaunchKernel)(CUfunction,unsigned int,unsigned int,unsigned int,unsigned int,unsigned int,unsigned int,unsigned int,void *,void **,void **) = NULL;
  CUresult (*p_cuCtxSynchronize)(void) = NULL;
  int exit_code = 1;
  CUcontext context = NULL;
  CUmodule module = NULL;
  CUdeviceptr output = 0;
  CUresult code = 0;
  const char *failed = "symbol lookup";
#define LOAD(symbol) do { *(void **)(&p_##symbol)=dlsym(lib,#symbol); if(!p_##symbol) goto cleanup; } while(0)
#define CALL(symbol,...) do { failed=#symbol; code=p_##symbol(__VA_ARGS__); if(code!=0) goto cleanup; } while(0)
  LOAD(cuInit); LOAD(cuDeviceGetCount); LOAD(cuDeviceGet); LOAD(cuDeviceGetName);
  LOAD(cuCtxCreate_v2); LOAD(cuCtxDestroy_v2); LOAD(cuModuleLoadData);
  LOAD(cuModuleGetFunction); LOAD(cuModuleUnload); LOAD(cuMemAlloc_v2);
  LOAD(cuMemFree_v2); LOAD(cuMemcpyDtoH_v2); LOAD(cuLaunchKernel); LOAD(cuCtxSynchronize);
  CALL(cuInit,0);
  int count=0;
  CALL(cuDeviceGetCount,&count);
  if(count<1){failed="no CUDA device";goto cleanup;}
  CUdevice device=0;
  CALL(cuDeviceGet,&device,0);
  char name[128]={0};
  CALL(cuDeviceGetName,name,(int)sizeof(name),device);
  for(size_t i=0;name[i];i++)if(!(name[i]>='a'&&name[i]<='z')&&
    !(name[i]>='A'&&name[i]<='Z')&&!(name[i]>='0'&&name[i]<='9')&&
    name[i]!=' '&&name[i]!='-'&&name[i]!='_'&&name[i]!='.')name[i]='_';
  CALL(cuCtxCreate_v2,&context,0,device);
  CALL(cuModuleLoadData,&module,ptx);
  CUfunction kernel=NULL;
  CALL(cuModuleGetFunction,&kernel,module,"hello_neo");
  CALL(cuMemAlloc_v2,&output,sizeof(uint32_t));
  void *params[]={&output};
  CALL(cuLaunchKernel,kernel,1,1,1,1,1,1,0,NULL,params,NULL);
  CALL(cuCtxSynchronize);
  uint32_t value=0;
  CALL(cuMemcpyDtoH_v2,&value,output,sizeof(value));
  if(value!=42){failed="incorrect GPU kernel result";goto cleanup;}
  printf("{\"signature\":\"hello-neo-cuda-v1\",\"cuda\":true,\"device\":\"%s\",\"kernelResult\":%u}\n",name,value);
  exit_code=0;
cleanup:
  if(output) p_cuMemFree_v2(output);
  if(module) p_cuModuleUnload(module);
  if(context) p_cuCtxDestroy_v2(context);
  dlclose(lib);
  if(exit_code!=0) fprintf(stderr,"HELLO_NEO_CUDA_FAIL: %s (CUDA code %d)\n",failed,code);
  return exit_code;
}

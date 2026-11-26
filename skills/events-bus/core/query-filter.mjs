// Exact and prefix matching over arbitrary JSON fields. Bounded declarative
// predicates; no executable user code or regular expressions.
export function compileFilter(filter){
  if(filter===undefined||filter===null)return ()=>true;
  if(!Array.isArray(filter)||!filter.length||filter.length>8)throw Error('invalid filter groups');
  const groups=filter.map(group=>{
    if(!Array.isArray(group)||!group.length||group.length>8)throw Error('invalid filter conditions');
    return group.map(condition=>{
      const {path,op,value}=condition??{};
      if(typeof path!=='string'||path.length>128||!path.split('.').every(k=>/^[A-Za-z0-9_-]+$/.test(k))||
        !['eq','prefix','prefixSegment'].includes(op)||typeof value!=='string'||value.length>2048)throw Error('invalid filter condition');
      const keys=path.split('.');
      return row=>{
        let actual=row;
        for(const key of keys)actual=actual&&Object.hasOwn(actual,key)?actual[key]:undefined;
        if(op==='eq')return actual===value;
        if(typeof actual!=='string'||!actual.startsWith(value))return false;
        return op==='prefix'||(actual.length>value.length&&!actual.slice(value.length).includes('/'));
      };
    });
  });
  return row=>groups.some(group=>group.every(test=>test(row)));
}

/** Local convenience history, not a tamper-proof audit log. Each batch is one immutable snapshot. */
export class History<T> {
  private past: T[]=[]; private future: T[]=[];
  constructor(private current:T, private limit=40) {this.current=structuredClone(current);}
  get value():T{return structuredClone(this.current);}
  get canUndo():boolean{return this.past.length>0;}
  get canRedo():boolean{return this.future.length>0;}
  commit(value:T):T {this.past.push(structuredClone(this.current));if(this.past.length>this.limit)this.past.shift();this.current=structuredClone(value);this.future=[];return this.value;}
  undo():T {const value=this.past.pop();if(value!==undefined){this.future.push(structuredClone(this.current));this.current=value;}return this.value;}
  redo():T {const value=this.future.pop();if(value!==undefined){this.past.push(structuredClone(this.current));this.current=value;}return this.value;}
}

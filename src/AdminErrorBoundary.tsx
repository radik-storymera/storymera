import {Component,type ReactNode} from 'react';
type Props={children:ReactNode;onRetry?:()=>void};
type State={failed:boolean};
export class AdminErrorBoundary extends Component<Props,State>{
 state={failed:false};
 static getDerivedStateFromError():State{return {failed:true};}
 componentDidCatch(error:Error){console.error('Scene editor failed:',error);}
 render(){return this.state.failed?<section className="admin-panel" role="alert"><h2>The editor could not show this scene.</h2><p>Your unsaved edits are still in this tab. Try reopening the editor. If the problem continues, keep this tab open and contact the owner.</p><button onClick={()=>{this.setState({failed:false});this.props.onRetry?.();}}>Try again</button></section>:this.props.children;}
}

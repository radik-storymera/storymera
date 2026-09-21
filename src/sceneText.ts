import sanitizeHtml from 'sanitize-html';

const htmlTag=/<\/?[a-z][^>]*>/i;
const options:sanitizeHtml.IOptions={
 allowedTags:['p','br','strong','em','ul','ol','li'],
 allowedAttributes:{},
 allowedSchemes:[],
 disallowedTagsMode:'discard',
 nonTextTags:['script','style','textarea','option','iframe','object','svg','math'],
 transformTags:{b:'strong',i:'em',div:'p',h1:'p',h2:'p',h3:'p',h4:'p',h5:'p',h6:'p',pre:'p'},
};

const escapeHtml=(text:string)=>text.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));

export function sanitizeSceneText(value:string):string{
 if(!htmlTag.test(value))return value;
 return sanitizeHtml(value,options);
}

export function sceneTextToHtml(value:string):string{
 if(!value)return '';
 if(htmlTag.test(value))return sanitizeSceneText(value);
 return plainTextToHtml(value);
}

export function plainTextToHtml(value:string):string{
 return value.replace(/\r\n?/g,'\n').split(/\n{2,}/).map(paragraph=>`<p>${escapeHtml(paragraph).replace(/\n/g,'<br>')}</p>`).join('');
}

export function sceneTextHasContent(value:string):boolean{
 const plain=htmlTag.test(value)?sanitizeSceneText(value).replace(/<[^>]*>/g,''):value;
 return plain.replace(/&nbsp;|\u00a0/g,' ').trim().length>0;
}

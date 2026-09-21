declare const __PUBLIC_SITE_URL__: string;

export const SITE_NAME='Storymera';
export const BRAND_LOGO='/brand/storymera-logo.png';

export function publicSiteUrl(path='/'){
 const base=__PUBLIC_SITE_URL__||window.location.origin;
 return new URL(path,base).href;
}

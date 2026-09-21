export function newSceneId(title: string, existing: Record<string, unknown>, uuid: () => string = () => crypto.randomUUID()): string {
  const slug = title.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/g, '') || 'scene';
  let id: string;
  do { id = `${slug}-${uuid().replace(/-/g, '').slice(0, 12)}`; }
  while (Object.hasOwn(existing, id));
  return id;
}

export const newStoryId = newSceneId;

export function selectedSceneId(scenes: Record<string, unknown>, current: string, next: string): string {
  return Object.hasOwn(scenes, next) ? next : current;
}

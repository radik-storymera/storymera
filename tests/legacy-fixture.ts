import {heroine,chapter,scenes} from '../server/legacy-story.ts';
import {configureStories} from '../src/story.ts';
export function legacyFixture(){configureStories([{...heroine,chapters:[{id:chapter.id,title:chapter.title,description:chapter.subtitle,revision:1}]}],[{chapter:{...chapter,heroineId:heroine.id},scenes}],heroine.id);}

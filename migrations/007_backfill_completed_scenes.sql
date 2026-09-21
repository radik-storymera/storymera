UPDATE progress p
JOIN chapter_versions v ON v.chapter_id=p.chapter_id AND v.revision=p.story_revision
SET p.completed_scenes=(
 SELECT COALESCE(JSON_ARRAYAGG(sequence.scene_id),JSON_ARRAY())
 FROM (
  SELECT ids.scene_id,
   CAST(JSON_UNQUOTE(JSON_EXTRACT(v.document,CONCAT('$.scenes."',ids.scene_id,'".step'))) AS SIGNED) AS step
  FROM JSON_TABLE(JSON_KEYS(v.document,'$.scenes'),'$[*]' COLUMNS(scene_id VARCHAR(64) PATH '$')) AS ids
 ) AS sequence
 WHERE sequence.step<CAST(JSON_UNQUOTE(JSON_EXTRACT(v.document,CONCAT('$.scenes."',p.scene_id,'".step'))) AS SIGNED)
)
WHERE JSON_LENGTH(p.completed_scenes)=0;

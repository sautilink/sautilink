-- Refine the Government Official professional category without changing the category system.
-- This keeps the title and slug stable while correcting its public grouping and explanation.

update public.profile_categories
set
  group_name = 'Government & Public Service',
  description = 'For elected or appointed public-sector officeholders and authorised government representatives serving in an official capacity, such as presidents, vice presidents, ministers, governors, mayors, legislators, commissioners and other recognised government officials.'
where slug = 'government-official';

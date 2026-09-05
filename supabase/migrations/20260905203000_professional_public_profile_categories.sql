-- Professional public profile categories for SautiLink.
-- Canonicalized from professional-category taxonomies used by major social platforms.
-- Near-synonyms are intentionally collapsed (for example Digital Creator -> Content Creator).

create table if not exists public.profile_categories (
  slug text primary key,
  label text not null unique,
  group_name text not null,
  description text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profile_categories enable row level security;

revoke all on table public.profile_categories from anon, authenticated;
grant select on table public.profile_categories to anon, authenticated;

drop policy if exists profile_categories_read_all on public.profile_categories;
create policy profile_categories_read_all
on public.profile_categories
for select
to anon, authenticated
using (true);

with category_groups(group_name, labels) as (
values
  ('Creators & Public Figures','Content Creator|Blogger|Vlogger|Video Creator|Gaming Video Creator|Podcaster|Influencer|Public Figure|Entrepreneur|Actor|Comedian|Dancer|Model|Fashion Model|Fitness Model|Athlete|Coach|Motivational Speaker|Magician|Artist|Visual Artist|Author|Writer|Editor|Journalist|News Personality|Photographer|Videographer|Film Director|Producer|Musician|Band|DJ|Chef|Teacher|Tutor|Scientist|Researcher|Designer|Graphic Designer|Web Designer|Fashion Designer|Interior Designer|Architect|Developer|Software Developer|Game Developer|Streamer|Professional Gamer|Government Official|Politician|Political Candidate|Religious Leader|Community Leader|Activist|Consultant|Personal Coach|Personal Trainer|Makeup Artist|Tattoo Artist|Hair Stylist|Travel Creator|Food Creator'),
  ('Media, Publishing & Entertainment','Media Company|News & Media Website|Newspaper|Magazine|Publisher|Publishing Company|Radio Station|TV Channel|TV Network|Broadcasting & Media Production Company|Movie/Television Studio|Record Label|Music Production Studio|Podcast Network|Entertainment Website|Entertainment Company|Arts & Entertainment|Film|Movie|TV Show|Music|Album|Song|Music Video|Book|Book Series|Literary Arts|Performing Arts|Performance Art|Theater|Comedy Club|Live Music Venue|Concert Tour|Event|Festival|Media Agency|Talent Agency|Public Relations Agency|Social Media Agency'),
  ('Technology & Digital','Technology Company|Software Company|Information Technology Service|Internet Company|Internet Service Provider|Telecommunication Company|Computer Company|Computer Repair Service|Computer Store|Computer Training School|Electronics Company|Electronics Store|App Page|Web Hosting Company|Cloud Service|Cybersecurity Service|Data Service|AI Company|Robotics Company|Biotechnology Company|Engineering Service|Automation Service|Digital Marketing Agency|Internet Marketing Service|E-Commerce Website|Website|Education Website|Health & Wellness Website|Business & Economy Website|Society & Culture Website|Science Website|Local & Travel Website|Reference Website'),
  ('Business & Professional Services','Business|Company|Brand|Local Business|Professional Service|Business Service|Business Consultant|Consulting Agency|Management Service|Marketing Agency|Marketing Consultant|Advertising Agency|Advertising/Marketing|Brand Agency|Market Research Consultant|Employment Agency|Recruiter|Human Resources Service|Copywriting Service|Writing Service|Translation Service|Translator|Secretarial Service|Printing Service|Signs & Banner Service|Event Planner|Wedding Planning Service|Event Photographer|Event Videographer|Photography & Videography Service|Cleaning Service|Security Guard Service|Private Investigator|Notary Public|Insurance Agent|Insurance Broker|Insurance Company|Tax Preparation Service|Franchising Service|Merchandising Service|Import/Export Company|Wholesale & Supply Store|Commercial & Industrial|Industrial Company|Manufacturing Company|Logistics Company|Shipping Service|Courier Service|Storage Facility|Self-Storage Facility'),
  ('Finance & Legal','Accountant|Bank|Commercial Bank|Retail Bank|Credit Union|Finance Company|Financial Service|Financial Consultant|Financial Planner|Investment Bank|Investment Management Company|Investing Service|Brokerage Firm|Loan Service|Mortgage Broker|Credit Counseling Service|Currency Exchange|Lawyer|Law Firm|Legal Service|Corporate Lawyer|Criminal Lawyer|Immigration Lawyer|Intellectual Property Lawyer|Estate Planning Lawyer|Divorce & Family Lawyer|Personal Injury Lawyer|Property Lawyer|Real Estate Lawyer|Bail Bonds Service'),
  ('Health & Wellness','Medical & Health|Doctor|Family Doctor|Family Medicine Practice|Pediatrician|Dermatologist|Neurologist|Ophthalmologist|Optometrist|Optician|Dentist|Cosmetic Dentist|Orthodontist|Oral Surgeon|Plastic Surgeon|Obstetrician-Gynecologist|Urologist|Podiatrist|Psychologist|Psychotherapist|Therapist|Counselor|Marriage Therapist|Mental Health Service|Occupational Therapist|Physical Therapist|Speech Pathologist|Nutritionist|Naturopath|Chiropractor|Audiologist|Allergist|Acupuncturist|Massage Therapist|Fitness Trainer|Yoga Instructor|Pilates Instructor|Hospital|Medical Center|Medical Clinic|Medical Lab|Pharmacy|Medical Spa|Health Spa|Wellness Center|Alternative & Holistic Health Service|Home Health Care Service|Emergency Rescue Service|Safety & First Aid Service|Fertility Clinic|Pregnancy Care Center|Women''s Health Clinic|Addiction Treatment Center'),
  ('Education & Research','Education|School|Preschool|Elementary School|Middle School|High School|College & University|University|Community College|Private School|Public School|Trade School|Language School|Driving School|Flight School|Aviation School|Cooking School|Dance School|Art School|Music School|Nursing School|Medical School|Test Preparation Center|Educational Consultant|Education Company|Educational Research Center|Research Institute|Academic Camp|Library|Science Museum|Museum|Planetarium|Observatory'),
  ('Government & Community','Government Organization|Government Website|Government Building|Public & Government Service|Public Service|Law Enforcement Agency|Police Station|Consulate & Embassy|Community Organization|Community Center|Community Service|Community|Organization|Public Utility Company|Water Utility Company|City Infrastructure|Political Organization|Political Party|Labor Union|Youth Organization|Social Club|Private Members Club|Sorority & Fraternity'),
  ('Nonprofit, Cause & Faith','Nonprofit Organization|Non-Governmental Organization (NGO)|Charity Organization|Cause|Social Service|Environmental Conservation Organization|Religious Organization|Religious Center|Church|Christian Church|Mosque|Hindu Temple|Sikh Temple|Synagogue|Monastery|Faith Community'),
  ('Sports, Fitness & Recreation','Sports|Sport|Sports Club|Sports Team|Professional Sports Team|Amateur Sports Team|Sports League|Esports League|Sports Promoter|Sports & Fitness Instruction|Gym/Fitness Center|Fitness Boot Camp|Martial Arts School|Boxing Studio|Yoga Studio|Pilates Studio|Golf Course & Country Club|Tennis Court|Soccer Field|Cricket Ground|Race Track|Stadium & Sports Venue|Swimming Instructor|Scuba Instructor|Scuba Diving Center|Rock Climbing Gym|Ski Resort|Skateboard Park|Go-Kart Track|Outdoor Recreation|Recreation Center|Recreation & Sports Website|Fishing Spot|Hiking Trail|Surfing Spot'),
  ('Food & Hospitality','Restaurant|Cafe|Coffee Shop|Bakery|Bar|Bar & Grill|Pub|Lounge|Night Club|Cocktail Bar|Wine Bar|Tea Room|Dessert Shop|Ice Cream Shop|Food & Beverage|Food & Beverage Company|Food Consultant|Food Delivery Service|Food Truck|Caterer|Hotel & Lodging|Hotel|Hotel Resort|Hostel|Inn|Motel|Bed & Breakfast|Beach Resort|Hospitality Service|Vacation Home Rental|Restaurant Supply Store|Fast Food Restaurant|Pizza Place|Seafood Restaurant|Vegetarian/Vegan Restaurant|African Restaurant|American Restaurant|Asian Restaurant|Chinese Restaurant|Indian Restaurant|Italian Restaurant|Japanese Restaurant|Korean Restaurant|Mexican Restaurant|Thai Restaurant|Mediterranean Restaurant|Middle Eastern Restaurant|Ethiopian Restaurant|South African Restaurant|Brazilian Restaurant|French Restaurant|Greek Restaurant|Lebanese Restaurant|Vietnamese Restaurant|Caribbean Restaurant'),
  ('Retail & Commerce','Shopping & Retail|Retail Company|Department Store|Supermarket|Grocery Store|Convenience Store|Organic Grocery Store|Specialty Grocery Store|Market|Farmers Market|Gift Shop|Bookstore|Independent Bookstore|Antique Store|Vintage Store|Thrift & Consignment Store|Outlet Store|Pop-Up Shop|Toy Store|Camera Store|Mobile Phone Shop|Hardware Store|Furniture Store|Home Goods Store|Garden Center|Pet Store|Sporting Goods Store|Outdoor Equipment Store|Jewelry Store|Footwear Store|Clothing Store|Beauty Store|Cosmetics Store|Appliance Store|Office Supplies Store|Fabric Store|Art Supply Store|Collectibles Store|Music Store|Video Game Store|Bicycle Shop|Wholesale Store|Product/Service'),
  ('Fashion & Beauty','Fashion|Apparel & Clothing|Clothing Brand|Fashion Company|Beauty, Cosmetic & Personal Care|Beauty Salon|Hair Salon|Barber Shop|Nail Salon|Skin Care Service|Makeup Service|Hair Removal Service|Laser Hair Removal Service|Waxing Service|Spa|Day Spa|Tanning Salon|Jewelry & Watches|Accessories|Bags & Luggage|Women''s Clothing Store|Men''s Clothing Store|Baby & Children''s Clothing Store|Bridal Shop|Lingerie Store|Swimwear Store|Sportswear Store|Uniform Supplier|Image Consultant'),
  ('Travel & Transportation','Travel & Transportation|Travel Agency|Travel Company|Travel Service|Tour Agency|Tour Guide|Sightseeing Tour Agency|Eco Tour Agency|Historical Tour Agency|Food Tour Agency|Tourist Information Center|Airline Company|Airport|Airport Shuttle Service|Bus Line|Bus Tour Agency|Charter Bus Service|Taxi Service|Limo Service|Rideshare Service|Train Station|Transit System|Transportation Service|Cargo & Freight Company|Cruise Line|Cruise Agency|Boat Tour Agency|Boat/Ferry Company|Car Rental|Bike Rental|Scooter Rental|Jet Ski Rental'),
  ('Real Estate & Construction','Real Estate|Real Estate Agent|Real Estate Company|Real Estate Developer|Real Estate Investment Firm|Real Estate Appraiser|Real Estate Service|Property Management Company|Commercial Real Estate Agency|Apartment & Condo Building|Construction Company|Contractor|Architectural Designer|Landscape Architect|Landscape Designer|Landscape Company|Interior Design Studio|Home Inspector|Structural Engineer|Surveyor|Engineering Company|Concrete Contractor|Masonry Contractor|Roofing Service|Plumbing Service|Electrician|Paving & Asphalt Service|Demolition & Excavation Company|Building Material Store|Building Materials|Cabinet & Countertop Store|Flooring Store'),
  ('Home & Local Services','Home Improvement|Home Improvement Service|Home Decor|Home & Garden Store|Home Security Company|Moving & Storage Service|Home Mover|House Painting|Painter|Gardener|Landscaping Service|Locksmith|Laundromat|Dry Cleaner|Janitorial Service|Pest Control Service|Appliance Repair Service|Heating & Air Conditioning Service|Refrigeration Service|Garage Door Service|Window Installation Service|Water Treatment Service|Waste Management Company|Recycling Center|Sewer Service|Towing Service|Tree Service|Sewing & Alterations'),
  ('Agriculture & Environment','Agriculture|Agricultural Cooperative|Agricultural Service|Farm|Urban Farm|Dairy Farm|Livestock Farm|Fish Farm|Forestry & Logging|Forestry Service|Environmental Consultant|Environmental Service|Solar Energy Company|Solar Energy Service|Energy Company|Mining Company|Petroleum Service|Nature Preserve|National Park|National Forest|Wildlife Sanctuary|Botanical Garden'),
  ('Automotive & Mobility','Automotive Dealership|Car Dealership|Automotive Manufacturer|Automotive Repair Shop|Automotive Service|Automotive Body Shop|Auto Detailing Service|Automotive Customization Shop|Automotive Parts Store|Automotive Glass Service|Car Wash|Motor Vehicle Company|Motorcycle Dealership|Motorcycle Manufacturer|Motorcycle Repair Shop|Bicycle Repair Service|Boat Dealership|Boat Rental|Boat Service|Commercial Truck Dealership|Tire Dealer & Repair Shop'),
  ('Events, Venues & Attractions','Event Venue|Wedding Venue|Convention Center|Auditorium|Amphitheater|Movie Theater|Opera House|Performance Art Theatre|Art Gallery|Art Museum|History Museum|Aquarium|Zoo|Theme Park|Water Park|Casino|Bowling Alley|Karaoke|Escape Room|Playground|Park|Landmark & Historical Place|Cultural Center'),
  ('Pets & Animals','Pet|Pet Service|Pet Supplies|Pet Groomer|Pet Sitter|Pet Breeder|Pet Adoption Service|Animal Shelter|Veterinarian|Kennel|Dog Trainer|Dog Walker|Dog Day Care Center|Horse Trainer|Horseback Riding Center|Petting Zoo'),
  ('Other Professional','Local Service|Personal Assistant|Workplace & Office|Work Position|Other')
),
catalog as (
  select
    lower(regexp_replace(regexp_replace(label, '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g')) as slug,
    label,
    group_name
  from category_groups
  cross join lateral unnest(string_to_array(labels, '|')) as label
),
prepared as (
  select
    slug,
    label,
    group_name,
    row_number() over (order by group_name, label)::integer as sort_order,
    case
      when slug = 'content-creator' then 'For people who create and publish original digital content such as videos, posts, podcasts, articles or other online media as a central part of their public work.'
      when slug = 'journalist' then 'For reporters, correspondents and other news professionals whose work focuses on researching, verifying and communicating information of public interest.'
      when slug = 'public-figure' then 'For people who are widely known publicly because of their profession, leadership, creative work, achievements or public role.'
      when slug = 'entrepreneur' then 'For people who build, own or lead businesses, products or ventures and identify entrepreneurship as a central part of their professional work.'
      when slug = 'media-company' then 'For organisations whose primary work is producing, publishing or distributing news, entertainment or other media content.'
      when slug = 'software-company' then 'For businesses that design, build, maintain or sell software products, platforms or digital services.'
      when slug = 'technology-company' then 'For businesses whose main products or services are built around technology, computing, electronics or digital innovation.'
      when slug = 'nonprofit-organization' then 'For mission-led organisations that operate primarily for public, social, charitable or community benefit rather than distributing profit to owners.'
      when slug = 'government-organization' then 'For official public-sector institutions, departments, agencies or bodies that perform government functions.'
      else case group_name
        when 'Creators & Public Figures' then 'Use this category for public professional profiles best described as “' || label || '” in creative work, public life or an individual professional role.'
        when 'Media, Publishing & Entertainment' then 'Use this category for people or organisations best described as “' || label || '” in media, publishing, culture or entertainment.'
        when 'Technology & Digital' then 'Use this category for professionals or organisations best described as “' || label || '” in technology or digital services.'
        when 'Business & Professional Services' then 'Use this category for professionals, teams or businesses whose primary activity is best described as “' || label || '”.'
        when 'Finance & Legal' then 'Use this category for professionals or organisations best described as “' || label || '” in finance, insurance, investment or legal services.'
        when 'Health & Wellness' then 'Use this category for professionals, organisations or services best described as “' || label || '” in health, care, fitness or wellness.'
        when 'Education & Research' then 'Use this category for educators, institutions or organisations best described as “' || label || '” in learning, training or research.'
        when 'Government & Community' then 'Use this category for public institutions, civic bodies or community organisations best described as “' || label || '”.'
        when 'Nonprofit, Cause & Faith' then 'Use this category for organisations, communities or leaders best described as “' || label || '” in charitable, social, faith or cause-based work.'
        when 'Sports, Fitness & Recreation' then 'Use this category for people, teams, organisations or venues best described as “' || label || '” in sport, fitness or recreation.'
        when 'Food & Hospitality' then 'Use this category for businesses, professionals or venues best described as “' || label || '” in food, beverage or hospitality.'
        when 'Retail & Commerce' then 'Use this category for businesses best described as “' || label || '” in retail, commerce or product distribution.'
        when 'Fashion & Beauty' then 'Use this category for people, brands or businesses best described as “' || label || '” in fashion, beauty or personal care.'
        when 'Travel & Transportation' then 'Use this category for businesses, professionals or services best described as “' || label || '” in travel, tourism, logistics or transportation.'
        when 'Real Estate & Construction' then 'Use this category for professionals or businesses best described as “' || label || '” in property, architecture, construction or the built environment.'
        when 'Home & Local Services' then 'Use this category for professionals or businesses whose local service is best described as “' || label || '”.'
        when 'Agriculture & Environment' then 'Use this category for professionals, organisations or businesses best described as “' || label || '” in agriculture, natural resources, energy or the environment.'
        when 'Automotive & Mobility' then 'Use this category for businesses or professionals best described as “' || label || '” in vehicles, mobility or transport services.'
        when 'Events, Venues & Attractions' then 'Use this category for venues, attractions, organisers or organisations best described as “' || label || '”.'
        when 'Pets & Animals' then 'Use this category for professionals, organisations or businesses best described as “' || label || '” involving animals or pet care.'
        else 'Use this category for a public professional profile whose primary role or activity is best described as “' || label || '”.'
      end
    end as description
  from catalog
)
insert into public.profile_categories (slug,label,group_name,description,sort_order)
select slug,label,group_name,description,sort_order
from prepared
on conflict (slug) do update
set label = excluded.label,
    group_name = excluded.group_name,
    description = excluded.description,
    sort_order = excluded.sort_order;

alter table public.social_profiles
  add column if not exists professional_category_slug text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'social_profiles_professional_category_slug_fkey'
      and conrelid = 'public.social_profiles'::regclass
  ) then
    alter table public.social_profiles
      add constraint social_profiles_professional_category_slug_fkey
      foreign key (professional_category_slug)
      references public.profile_categories(slug)
      on update cascade
      on delete set null;
  end if;
end $$;

create index if not exists social_profiles_professional_category_slug_idx
  on public.social_profiles (professional_category_slug)
  where professional_category_slug is not null;

grant select, update (professional_category_slug) on public.social_profiles to authenticated;
grant select (professional_category_slug) on public.social_profiles to anon;

const LANGUAGE_STORAGE_KEY = 'sautilink.language';
const DEFAULT_LANGUAGE = 'en';

export const LANGUAGE_OPTIONS = Object.freeze([
  Object.freeze({ code: 'en', label: 'English' }),
  Object.freeze({ code: 'sw', label: 'Kiswahili' }),
  Object.freeze({ code: 'fr', label: 'Français' }),
]);

// Product/navigation names intentionally stay original in every language.
export const FEATURE_LABELS = Object.freeze(new Set([
  'SautiLink', 'Home', 'Discover', 'Messages', 'Notifications', 'Sautify',
  'Saved', 'Appeals', 'Moderation', 'Settings', 'Profile', 'Rooms',
]));

const SW = Object.freeze({
  'Skip to main content': 'Ruka hadi kwenye maudhui makuu',
  'Create Post': 'Tengeneza Posti',
  'Sign out': 'Toka',
  'Switch to light theme': 'Badili kwenda mandhari meupe',
  'Switch to dark theme': 'Badili kwenda mandhari meusi',
  'Account security': 'Usalama wa akaunti',
  'Verified': 'Imethibitishwa',
  'Dismiss': 'Funga',
  'Opening SautiLink…': 'Inafungua SautiLink…',
  'Connect with people, communities and conversations on SautiLink.': 'Ungana na watu, jumuiya na mazungumzo kwenye SautiLink.',
  'Share posts, follow people you care about and discover what is happening across the SautiLink network.': 'Shiriki posti, fuata watu unaowajali na gundua kinachoendelea kwenye mtandao wa SautiLink.',
  'Sign in': 'Ingia',
  'Create account': 'Fungua akaunti',
  'Log in to SautiLink': 'Ingia kwenye SautiLink',
  'Email address': 'Anwani ya barua pepe',
  'Email or username': 'Barua pepe au username',
  'Password': 'Nenosiri',
  'Show': 'Onyesha',
  'Hide': 'Ficha',
  'Log in': 'Ingia',
  'Forgot password?': 'Umesahau nenosiri?',
  'Log in with email code': 'Ingia kwa code ya barua pepe',
  'Create new account': 'Fungua akaunti mpya',
  'Full name': 'Jina kamili',
  'Username': 'Username',
  'Confirm password': 'Thibitisha nenosiri',
  'Continue': 'Endelea',
  'Back': 'Rudi',
  'Cancel': 'Ghairi',
  'Close': 'Funga',
  'Save': 'Hifadhi',
  'Delete': 'Futa',
  'Remove': 'Ondoa',
  'Retry': 'Jaribu tena',
  'Send': 'Tuma',
  'Search': 'Tafuta',
  'Follow': 'Fuata',
  'Following': 'Unafuata',
  'Unfollow': 'Acha kufuata',
  'Follower': 'Mfuasi',
  'Followers': 'Wafuasi',
  'Like': 'Penda',
  'Unlike': 'Ondoa kupenda',
  'Comment': 'Maoni',
  'Repost': 'Posti upya',
  'Undo repost': 'Ondoa posti upya',
  'Share': 'Shiriki',
  'Report': 'Ripoti',
  'Block': 'Zuia',
  'Unblock': 'Ondoa zuio',
  'Mute': 'Nyamazisha',
  'Unmute': 'Ondoa kunyamazisha',
  'View profile': 'Tazama profile',
  'Copy link': 'Nakili link',
  'Interested': 'Ninavutiwa',
  'Not interested': 'Sivutiwi',
  'Public': 'Umma',
  'Private': 'Faragha',
  'Everyone': 'Kila mtu',
  'No one': 'Hakuna mtu',
  'People you follow': 'Watu unaowafuata',
  'Only people mentioned': 'Waliotajwa tu',
  'Post': 'Posti',
  'Post saved.': 'Posti imehifadhiwa.',
  'Post deleted.': 'Posti imefutwa.',
  'Post published.': 'Posti imechapishwa.',
  'Your post is live.': 'Posti yako imechapishwa.',
  'Post link copied.': 'Link ya posti imenakiliwa.',
  'Draft saved on this device.': 'Rasimu imehifadhiwa kwenye kifaa hiki.',
  'Draft saved': 'Rasimu imehifadhiwa',
  'Save draft': 'Hifadhi rasimu',
  'Media': 'Media',
  'Image': 'Picha',
  'Video': 'Video',
  'Loading…': 'Inapakia…',
  'Preparing…': 'Inaandaliwa…',
  'Finalizing…': 'Inakamilishwa…',
  'Posting…': 'Inachapisha…',
  'Deleting…': 'Inafuta…',
  'Saving…': 'Inahifadhi…',
  'Sending…': 'Inatuma…',
  'Signing in…': 'Inaingia…',
  'Creating account…': 'Inafungua akaunti…',
  'Verifying…': 'Inathibitisha…',
  'Checking…': 'Inakagua…',
  'Checking': 'Inakagua',
  'Ready': 'Tayari',
  'Waiting': 'Inasubiri',
  'Online': 'Mtandaoni',
  'Typing…': 'Anaandika…',
  'Seen': 'Imeonekana',
  'Message sent.': 'Ujumbe umetumwa.',
  'Message deleted.': 'Ujumbe umefutwa.',
  'New conversation': 'Mazungumzo mapya',
  'Start a conversation': 'Anzisha mazungumzo',
  'Write a message…': 'Andika ujumbe…',
  'Write a comment…': 'Andika maoni…',
  'No comments yet.': 'Bado hakuna maoni.',
  'Loading comments…': 'Inapakia maoni…',
  'Comments could not load.': 'Maoni hayakuweza kupakiwa.',
  'Account controls': 'Udhibiti wa akaunti',
  'Privacy-first controls for your SautiLink account.': 'Udhibiti unaotanguliza faragha kwa akaunti yako ya SautiLink.',
  'Account': 'Akaunti',
  'Privacy': 'Faragha',
  'Safety': 'Usalama',
  'Your data': 'Data zako',
  'Language': 'Lugha',
  'Language preference': 'Lugha unayopendelea',
  'Choose the language SautiLink uses for menus, settings and system messages.': 'Chagua lugha ambayo SautiLink itatumia kwenye menyu, mipangilio na ujumbe wa mfumo.',
  'Interface language': 'Lugha ya mfumo',
  'Changes apply immediately on this browser. English is used whenever a translation is unavailable.': 'Mabadiliko yanaanza mara moja kwenye browser hii. English itatumika pale tafsiri inapokosekana.',
  'Language preference saved.': 'Lugha unayopendelea imehifadhiwa.',
  'Identity & security': 'Utambulisho na usalama',
  'Review your verified identity and session controls.': 'Kagua utambulisho wako uliothibitishwa na udhibiti wa session.',
  'Account identity': 'Utambulisho wa akaunti',
  'Private sign-in details': 'Taarifa binafsi za kuingia',
  'Email': 'Barua pepe',
  'Current session active.': 'Session ya sasa inafanya kazi.',
  'Sign out other sessions': 'Ondoa session nyingine',
  'Control your visibility': 'Dhibiti mwonekano wako',
  'Choose how people find and contact you.': 'Chagua namna watu wanavyokupata na kuwasiliana nawe.',
  'Discoverable account': 'Akaunti inayoweza kupatikana',
  'Allow people to find your public profile and public posts.': 'Ruhusu watu kupata profile yako ya umma na posti zako za umma.',
  'External search indexing': 'Kuorodheshwa na search za nje',
  'Read receipts': 'Uthibitisho wa kusoma',
  'Let a DM sender see when you have read their message.': 'Ruhusu mtumaji wa DM kuona unapokuwa umesoma ujumbe wake.',
  'Activity status': 'Hali ya shughuli',
  'Who can message you': 'Nani anaweza kukutumia ujumbe',
  'Applies to new DM delivery as well as existing conversations.': 'Inatumika kwa DM mpya pamoja na mazungumzo yaliyopo.',
  'Only useful signals': 'Taarifa muhimu tu',
  'Choose which activity appears in your in-app attention surfaces.': 'Chagua shughuli zitakazoonekana kwenye arifa za ndani ya app.',
  'Post activity': 'Shughuli za posti',
  'Replies, Likes and Reposts involving your posts.': 'Majibu, kupendwa na repost zinazohusu posti zako.',
  'Show unread message badges.': 'Onyesha alama za ujumbe ambao haujasomwa.',
  'New followers': 'Wafuasi wapya',
  'When another member follows you.': 'Mwanachama mwingine anapokufuata.',
  'Sautify activity': 'Shughuli za Sautify',
  'Membership and community updates from Sautify.': 'Taarifa za uanachama na jumuiya kutoka Sautify.',
  'Email summary': 'Muhtasari wa barua pepe',
  'Off': 'Imezimwa',
  'Daily': 'Kila siku',
  'Weekly': 'Kila wiki',
  'Your boundaries': 'Mipaka yako',
  'Safety controls': 'Udhibiti wa usalama',
  'Blocked and muted lists are private to you.': 'Orodha za waliozuiwa na kunyamazishwa ni za faragha kwako.',
  'Blocked accounts': 'Akaunti zilizozuiwa',
  'They cannot follow or message you.': 'Hawawezi kukufuata wala kukutumia ujumbe.',
  'No blocked accounts.': 'Hakuna akaunti zilizozuiwa.',
  'Muted accounts': 'Akaunti zilizonyamazishwa',
  'No muted accounts.': 'Hakuna akaunti zilizonyamazishwa.',
  'Portable and reversible': 'Inaweza kuhamishwa na kurejeshwa',
  'Request an export or manage the recoverable deletion window.': 'Omba export au dhibiti kipindi cha kurejesha akaunti kabla ya kufutwa.',
  'Download your data': 'Pakua data zako',
  'Request a private export of your SautiLink information.': 'Omba export binafsi ya taarifa zako za SautiLink.',
  'Request export': 'Omba export',
  'Cancel request': 'Ghairi ombi',
  'Delete your account': 'Futa akaunti yako',
  'Account deletion': 'Kufuta akaunti',
  'Profile basics saved.': 'Taarifa za msingi za profile zimehifadhiwa.',
  'Preference saved.': 'Chaguo limehifadhiwa.',
  'Privacy setting saved.': 'Mpangilio wa faragha umehifadhiwa.',
  'Message privacy saved.': 'Faragha ya ujumbe imehifadhiwa.',
  'Email summary preference saved.': 'Chaguo la muhtasari wa barua pepe limehifadhiwa.',
  'Profile photo updated.': 'Picha ya profile imesasishwa.',
  'Header image updated.': 'Picha ya header imesasishwa.',
  'Profile photo removed.': 'Picha ya profile imeondolewa.',
  'Header image removed.': 'Picha ya header imeondolewa.',
  'Edit profile': 'Hariri profile',
  'Save profile': 'Hifadhi profile',
  'Display name': 'Jina linaloonekana',
  'Bio': 'Wasifu mfupi',
  'Location': 'Mahali',
  'Website': 'Tovuti',
  'Name change request submitted.': 'Ombi la kubadili jina limetumwa.',
  'Username changed.': 'Username imebadilishwa.',
  'Display name changed.': 'Jina linaloonekana limebadilishwa.',
  'No identity change was needed.': 'Hakukuwa na mabadiliko ya utambulisho yaliyohitajika.',
  'Mark all as read': 'Weka zote kuwa zimesomwa',
  'No notifications yet.': 'Bado hakuna notifications.',
  'No saved posts yet.': 'Bado hakuna posti zilizohifadhiwa.',
  'No reports in this queue.': 'Hakuna ripoti kwenye foleni hii.',
  'No appeals in this queue.': 'Hakuna appeals kwenye foleni hii.',
  'Approve': 'Kubali',
  'Decline': 'Kataa',
  'Owner': 'Mmiliki',
  'Member': 'Mwanachama',
  'Joined': 'Umejiunga',
  'Request sent': 'Ombi limetumwa',
  'Join Sautify': 'Jiunge na Sautify',
  'Leave Sautify': 'Ondoka Sautify',
  'Request to join': 'Omba kujiunga',
  'Request again': 'Omba tena',
  'Open': 'Wazi',
  'Approval': 'Kwa idhini',
  'No description yet.': 'Bado hakuna maelezo.',
  'No pending requests.': 'Hakuna maombi yanayosubiri.',
  'No members to show.': 'Hakuna wanachama wa kuonyesha.',
  'Member approved.': 'Mwanachama amekubaliwa.',
  'Request declined.': 'Ombi limekataliwa.',
  'Join request sent.': 'Ombi la kujiunga limetumwa.',
  'You joined the Sautify.': 'Umejiunga na Sautify.',
  'You left the Sautify.': 'Umeondoka Sautify.',
  'Sautify created.': 'Sautify imetengenezwa.',
  'Reply': 'Jibu',
  'Replying…': 'Inajibu…',
  'Reply shared.': 'Jibu limetumwa.',
  'Conversation replies': 'Majibu ya mazungumzo',
  'Focused branch': 'Sehemu iliyochaguliwa',
  'Conversation': 'Mazungumzo',
  'Report submitted to SautiLink.': 'Ripoti imetumwa SautiLink.',
  'Account deletion requested.': 'Ombi la kufuta akaunti limetumwa.',
  'Account deletion request cancelled.': 'Ombi la kufuta akaunti limeghairiwa.',
  'Other sessions signed out. This session stays active.': 'Session nyingine zimeondolewa. Session hii inaendelea kufanya kazi.',
});

const FR = Object.freeze({
  'Skip to main content': 'Aller au contenu principal',
  'Create Post': 'Créer une publication',
  'Sign out': 'Se déconnecter',
  'Switch to light theme': 'Passer au thème clair',
  'Switch to dark theme': 'Passer au thème sombre',
  'Account security': 'Sécurité du compte',
  'Verified': 'Vérifié',
  'Dismiss': 'Fermer',
  'Opening SautiLink…': 'Ouverture de SautiLink…',
  'Connect with people, communities and conversations on SautiLink.': 'Connectez-vous avec des personnes, des communautés et des conversations sur SautiLink.',
  'Share posts, follow people you care about and discover what is happening across the SautiLink network.': 'Partagez des publications, suivez les personnes qui vous intéressent et découvrez ce qui se passe sur le réseau SautiLink.',
  'Sign in': 'Se connecter',
  'Create account': 'Créer un compte',
  'Log in to SautiLink': 'Se connecter à SautiLink',
  'Email address': 'Adresse e-mail',
  'Email or username': 'E-mail ou nom d’utilisateur',
  'Password': 'Mot de passe',
  'Show': 'Afficher',
  'Hide': 'Masquer',
  'Log in': 'Se connecter',
  'Forgot password?': 'Mot de passe oublié ?',
  'Log in with email code': 'Se connecter avec un code e-mail',
  'Create new account': 'Créer un nouveau compte',
  'Full name': 'Nom complet',
  'Username': 'Nom d’utilisateur',
  'Confirm password': 'Confirmer le mot de passe',
  'Continue': 'Continuer',
  'Back': 'Retour',
  'Cancel': 'Annuler',
  'Close': 'Fermer',
  'Save': 'Enregistrer',
  'Delete': 'Supprimer',
  'Remove': 'Retirer',
  'Retry': 'Réessayer',
  'Send': 'Envoyer',
  'Search': 'Rechercher',
  'Follow': 'Suivre',
  'Following': 'Suivi',
  'Unfollow': 'Ne plus suivre',
  'Follower': 'Abonné',
  'Followers': 'Abonnés',
  'Like': 'J’aime',
  'Unlike': 'Retirer le J’aime',
  'Comment': 'Commenter',
  'Repost': 'Republier',
  'Undo repost': 'Annuler la republication',
  'Share': 'Partager',
  'Report': 'Signaler',
  'Block': 'Bloquer',
  'Unblock': 'Débloquer',
  'Mute': 'Masquer',
  'Unmute': 'Réactiver',
  'View profile': 'Voir le profil',
  'Copy link': 'Copier le lien',
  'Interested': 'Intéressé',
  'Not interested': 'Pas intéressé',
  'Public': 'Public',
  'Private': 'Privé',
  'Everyone': 'Tout le monde',
  'No one': 'Personne',
  'People you follow': 'Personnes que vous suivez',
  'Only people mentioned': 'Uniquement les personnes mentionnées',
  'Post': 'Publication',
  'Post saved.': 'Publication enregistrée.',
  'Post deleted.': 'Publication supprimée.',
  'Post published.': 'Publication publiée.',
  'Your post is live.': 'Votre publication est en ligne.',
  'Post link copied.': 'Lien de la publication copié.',
  'Draft saved on this device.': 'Brouillon enregistré sur cet appareil.',
  'Draft saved': 'Brouillon enregistré',
  'Save draft': 'Enregistrer le brouillon',
  'Media': 'Média',
  'Image': 'Image',
  'Video': 'Vidéo',
  'Loading…': 'Chargement…',
  'Preparing…': 'Préparation…',
  'Finalizing…': 'Finalisation…',
  'Posting…': 'Publication…',
  'Deleting…': 'Suppression…',
  'Saving…': 'Enregistrement…',
  'Sending…': 'Envoi…',
  'Signing in…': 'Connexion…',
  'Creating account…': 'Création du compte…',
  'Verifying…': 'Vérification…',
  'Checking…': 'Vérification…',
  'Checking': 'Vérification',
  'Ready': 'Prêt',
  'Waiting': 'En attente',
  'Online': 'En ligne',
  'Typing…': 'Écrit…',
  'Seen': 'Vu',
  'Message sent.': 'Message envoyé.',
  'Message deleted.': 'Message supprimé.',
  'New conversation': 'Nouvelle conversation',
  'Start a conversation': 'Démarrer une conversation',
  'Write a message…': 'Écrire un message…',
  'Write a comment…': 'Écrire un commentaire…',
  'No comments yet.': 'Aucun commentaire pour le moment.',
  'Loading comments…': 'Chargement des commentaires…',
  'Comments could not load.': 'Impossible de charger les commentaires.',
  'Account controls': 'Contrôles du compte',
  'Privacy-first controls for your SautiLink account.': 'Contrôles axés sur la confidentialité pour votre compte SautiLink.',
  'Account': 'Compte',
  'Privacy': 'Confidentialité',
  'Safety': 'Sécurité',
  'Your data': 'Vos données',
  'Language': 'Langue',
  'Language preference': 'Préférence de langue',
  'Choose the language SautiLink uses for menus, settings and system messages.': 'Choisissez la langue utilisée par SautiLink pour les menus, les paramètres et les messages du système.',
  'Interface language': 'Langue de l’interface',
  'Changes apply immediately on this browser. English is used whenever a translation is unavailable.': 'Les modifications s’appliquent immédiatement dans ce navigateur. L’anglais est utilisé lorsqu’une traduction n’est pas disponible.',
  'Language preference saved.': 'Préférence de langue enregistrée.',
  'Identity & security': 'Identité et sécurité',
  'Review your verified identity and session controls.': 'Vérifiez votre identité et les contrôles de session.',
  'Account identity': 'Identité du compte',
  'Private sign-in details': 'Informations de connexion privées',
  'Email': 'E-mail',
  'Current session active.': 'Session actuelle active.',
  'Sign out other sessions': 'Déconnecter les autres sessions',
  'Control your visibility': 'Contrôlez votre visibilité',
  'Choose how people find and contact you.': 'Choisissez comment les personnes peuvent vous trouver et vous contacter.',
  'Discoverable account': 'Compte découvrable',
  'Allow people to find your public profile and public posts.': 'Autorisez les personnes à trouver votre profil public et vos publications publiques.',
  'External search indexing': 'Indexation par les moteurs externes',
  'Read receipts': 'Confirmations de lecture',
  'Let a DM sender see when you have read their message.': 'Permettez à l’expéditeur d’un DM de voir quand vous avez lu son message.',
  'Activity status': 'Statut d’activité',
  'Who can message you': 'Qui peut vous envoyer un message',
  'Applies to new DM delivery as well as existing conversations.': 'S’applique aux nouveaux DM ainsi qu’aux conversations existantes.',
  'Only useful signals': 'Uniquement les signaux utiles',
  'Choose which activity appears in your in-app attention surfaces.': 'Choisissez les activités affichées dans vos surfaces de notification.',
  'Post activity': 'Activité des publications',
  'Replies, Likes and Reposts involving your posts.': 'Réponses, mentions J’aime et republications liées à vos publications.',
  'Show unread message badges.': 'Afficher les badges de messages non lus.',
  'New followers': 'Nouveaux abonnés',
  'When another member follows you.': 'Lorsqu’un autre membre vous suit.',
  'Sautify activity': 'Activité Sautify',
  'Membership and community updates from Sautify.': 'Mises à jour des adhésions et des communautés Sautify.',
  'Email summary': 'Résumé par e-mail',
  'Off': 'Désactivé',
  'Daily': 'Quotidien',
  'Weekly': 'Hebdomadaire',
  'Your boundaries': 'Vos limites',
  'Safety controls': 'Contrôles de sécurité',
  'Blocked and muted lists are private to you.': 'Les listes de comptes bloqués et masqués sont privées.',
  'Blocked accounts': 'Comptes bloqués',
  'They cannot follow or message you.': 'Ils ne peuvent ni vous suivre ni vous envoyer de message.',
  'No blocked accounts.': 'Aucun compte bloqué.',
  'Muted accounts': 'Comptes masqués',
  'No muted accounts.': 'Aucun compte masqué.',
  'Portable and reversible': 'Portable et réversible',
  'Request an export or manage the recoverable deletion window.': 'Demandez un export ou gérez la période de récupération avant suppression.',
  'Download your data': 'Télécharger vos données',
  'Request a private export of your SautiLink information.': 'Demandez un export privé de vos informations SautiLink.',
  'Request export': 'Demander un export',
  'Cancel request': 'Annuler la demande',
  'Delete your account': 'Supprimer votre compte',
  'Account deletion': 'Suppression du compte',
  'Profile basics saved.': 'Informations du profil enregistrées.',
  'Preference saved.': 'Préférence enregistrée.',
  'Privacy setting saved.': 'Paramètre de confidentialité enregistré.',
  'Message privacy saved.': 'Confidentialité des messages enregistrée.',
  'Email summary preference saved.': 'Préférence de résumé par e-mail enregistrée.',
  'Profile photo updated.': 'Photo de profil mise à jour.',
  'Header image updated.': 'Image d’en-tête mise à jour.',
  'Profile photo removed.': 'Photo de profil supprimée.',
  'Header image removed.': 'Image d’en-tête supprimée.',
  'Edit profile': 'Modifier le profil',
  'Save profile': 'Enregistrer le profil',
  'Display name': 'Nom affiché',
  'Bio': 'Bio',
  'Location': 'Lieu',
  'Website': 'Site web',
  'Name change request submitted.': 'Demande de changement de nom envoyée.',
  'Username changed.': 'Nom d’utilisateur modifié.',
  'Display name changed.': 'Nom affiché modifié.',
  'No identity change was needed.': 'Aucun changement d’identité n’était nécessaire.',
  'Mark all as read': 'Tout marquer comme lu',
  'No notifications yet.': 'Aucune notification pour le moment.',
  'No saved posts yet.': 'Aucune publication enregistrée pour le moment.',
  'No reports in this queue.': 'Aucun signalement dans cette file.',
  'No appeals in this queue.': 'Aucun recours dans cette file.',
  'Approve': 'Approuver',
  'Decline': 'Refuser',
  'Owner': 'Propriétaire',
  'Member': 'Membre',
  'Joined': 'Inscrit',
  'Request sent': 'Demande envoyée',
  'Join Sautify': 'Rejoindre Sautify',
  'Leave Sautify': 'Quitter Sautify',
  'Request to join': 'Demander à rejoindre',
  'Request again': 'Demander à nouveau',
  'Open': 'Ouvert',
  'Approval': 'Sur approbation',
  'No description yet.': 'Aucune description pour le moment.',
  'No pending requests.': 'Aucune demande en attente.',
  'No members to show.': 'Aucun membre à afficher.',
  'Member approved.': 'Membre approuvé.',
  'Request declined.': 'Demande refusée.',
  'Join request sent.': 'Demande d’adhésion envoyée.',
  'You joined the Sautify.': 'Vous avez rejoint Sautify.',
  'You left the Sautify.': 'Vous avez quitté Sautify.',
  'Sautify created.': 'Sautify créé.',
  'Reply': 'Répondre',
  'Replying…': 'Réponse…',
  'Reply shared.': 'Réponse envoyée.',
  'Conversation replies': 'Réponses de la conversation',
  'Focused branch': 'Branche sélectionnée',
  'Conversation': 'Conversation',
  'Report submitted to SautiLink.': 'Signalement envoyé à SautiLink.',
  'Account deletion requested.': 'Suppression du compte demandée.',
  'Account deletion request cancelled.': 'Demande de suppression du compte annulée.',
  'Other sessions signed out. This session stays active.': 'Les autres sessions ont été déconnectées. Cette session reste active.',
});

const DICTIONARIES = Object.freeze({ sw: SW, fr: FR });
const SUPPORTED = new Set(LANGUAGE_OPTIONS.map(({ code }) => code));
const textOrigins = new WeakMap();
const attributeOrigins = new WeakMap();
let activeLanguage = DEFAULT_LANGUAGE;
let applying = false;
let observer = null;

const USER_CONTENT_SELECTOR = [
  '.sauti-card-body', '.sauti-caption-text', '.sauti-comment-body', '.sauti-quote-body',
  '#profile-bio', '#profile-display-name', '#profile-username', '#member-display-name', '#member-username',
  '#rail-name', '#rail-username', '.verified-name', '.inline-verified-name', '.message-inbox-preview',
  '.dm-message p', '#message-thread-name', '#message-thread-username', '.circle-card h3',
  '.circle-card-description', '#circle-detail-name', '#circle-detail-description', '.circle-member-person',
  '.circle-request-person', '.discover-profile-copy > p', '.settings-account-row strong',
  '.settings-account-row small', '.moderation-context', '.moderation-reporter-context',
  '[data-language-no-translate]',
].join(',');

const TRANSLATABLE_ATTRIBUTES = Object.freeze(['placeholder', 'aria-label', 'title']);

export function normalizeLanguage(value) {
  const code = String(value || '').trim().toLowerCase().split(/[-_]/, 1)[0];
  return SUPPORTED.has(code) ? code : DEFAULT_LANGUAGE;
}

export function translateSystemText(value, language = activeLanguage) {
  const source = String(value ?? '');
  const trimmed = source.trim();
  const lang = normalizeLanguage(language);
  if (!trimmed || lang === DEFAULT_LANGUAGE || FEATURE_LABELS.has(trimmed)) return source;
  const translated = DICTIONARIES[lang]?.[trimmed];
  if (!translated) return source;
  const start = source.indexOf(trimmed);
  const end = start + trimmed.length;
  return `${source.slice(0, start)}${translated}${source.slice(end)}`;
}

function readStoredLanguage() {
  try {
    return normalizeLanguage(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

function shouldSkipElement(element) {
  if (!(element instanceof Element)) return false;
  return Boolean(element.closest(USER_CONTENT_SELECTOR));
}

function isKnownRendering(current, origin) {
  if (current === origin) return true;
  for (const { code } of LANGUAGE_OPTIONS) {
    if (current === translateSystemText(origin, code)) return true;
  }
  return false;
}

function resolveTextOrigin(node) {
  const current = node.nodeValue || '';
  const previous = textOrigins.get(node);
  if (previous === undefined) {
    textOrigins.set(node, current);
    return current;
  }
  if (!isKnownRendering(current, previous)) {
    textOrigins.set(node, current);
    return current;
  }
  return previous;
}

function applyTextNode(node, language) {
  const parent = node.parentElement;
  if (!parent || shouldSkipElement(parent) || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(parent.tagName)) return;
  const origin = resolveTextOrigin(node);
  const next = translateSystemText(origin, language);
  if (node.nodeValue !== next) node.nodeValue = next;
}

function resolveAttributeOrigin(element, attribute) {
  const current = element.getAttribute(attribute);
  if (current == null) return null;
  let origins = attributeOrigins.get(element);
  if (!origins) {
    origins = new Map();
    attributeOrigins.set(element, origins);
  }
  if (!origins.has(attribute)) {
    origins.set(attribute, current);
    return current;
  }
  const previous = origins.get(attribute);
  if (!isKnownRendering(current, previous)) origins.set(attribute, current);
  return origins.get(attribute);
}

function applyAttributes(element, language) {
  if (!(element instanceof Element) || shouldSkipElement(element)) return;
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    if (!element.hasAttribute(attribute)) continue;
    const origin = resolveAttributeOrigin(element, attribute);
    const next = translateSystemText(origin, language);
    if (element.getAttribute(attribute) !== next) element.setAttribute(attribute, next);
  }
}

function applyTree(root, language) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    applyTextNode(root, language);
    return;
  }
  if (!(root instanceof Element) && root !== document.body) return;
  if (root instanceof Element) applyAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) applyTextNode(node, language);
    else applyAttributes(node, language);
    node = walker.nextNode();
  }
}

function languagePanelMarkup() {
  return `
    <div class="settings-panel-heading">
      <p class="section-label">Language preference</p>
      <h3>Language</h3>
      <p>Choose the language SautiLink uses for menus, settings and system messages.</p>
    </div>
    <article class="settings-card">
      <label class="settings-select">
        <span>
          <strong>Interface language</strong>
          <small>Changes apply immediately on this browser. English is used whenever a translation is unavailable.</small>
        </span>
        <select id="settings-language-preference" aria-label="Language preference">
          <option value="en">English</option>
          <option value="sw">Kiswahili</option>
          <option value="fr">Français</option>
        </select>
      </label>
    </article>`;
}

function showLanguagePanel(button, panel) {
  document.querySelectorAll('[data-settings-section]').forEach((item) => {
    const selected = item === button;
    item.classList.toggle('active', selected);
    if (selected) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-settings-panel]').forEach((item) => {
    item.hidden = item !== panel;
  });
}

function installLanguageSettings() {
  const tabs = document.querySelector('.settings-tabs');
  const surface = document.getElementById('settings-surface');
  if (!tabs || !surface) return;

  let button = tabs.querySelector('[data-settings-section="language"]');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.dataset.settingsSection = 'language';
    button.textContent = 'Language';
    tabs.append(button);
  }

  let panel = surface.querySelector('[data-settings-panel="language"]');
  if (!panel) {
    panel = document.createElement('section');
    panel.className = 'settings-panel';
    panel.dataset.settingsPanel = 'language';
    panel.hidden = true;
    panel.innerHTML = languagePanelMarkup();
    surface.append(panel);
  }

  const select = panel.querySelector('#settings-language-preference');
  if (select) {
    select.value = activeLanguage;
    select.addEventListener('change', () => {
      setLanguage(select.value);
      const status = document.getElementById('settings-message');
      if (status) {
        status.textContent = translateSystemText('Language preference saved.', activeLanguage);
        status.className = 'form-message settings-message success';
        status.hidden = false;
      }
    });
  }

  // Existing settings routing only knows its original sections. Keep this isolated
  // from that router so no account/privacy/notification behavior is changed.
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showLanguagePanel(button, panel);
  });
}

function installObserver() {
  if (observer || typeof MutationObserver === 'undefined') return;
  observer = new MutationObserver((records) => {
    if (applying) return;
    applying = true;
    try {
      for (const record of records) {
        if (record.type === 'characterData') {
          applyTextNode(record.target, activeLanguage);
          continue;
        }
        if (record.type === 'attributes') {
          applyAttributes(record.target, activeLanguage);
          continue;
        }
        for (const node of record.addedNodes) applyTree(node, activeLanguage);
      }
    } finally {
      applying = false;
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: TRANSLATABLE_ATTRIBUTES,
  });
}

export function getLanguage() {
  return activeLanguage;
}

export function setLanguage(value, { persist = true } = {}) {
  const next = normalizeLanguage(value);
  activeLanguage = next;
  document.documentElement.lang = next;
  document.documentElement.dataset.language = next;
  if (persist) {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // Language still applies in-memory if browser storage is unavailable.
    }
  }

  applying = true;
  try {
    applyTree(document.body, next);
    const select = document.getElementById('settings-language-preference');
    if (select && select.value !== next) select.value = next;
  } finally {
    applying = false;
  }

  window.dispatchEvent(new CustomEvent('sautilink:languagechange', { detail: { language: next } }));
  return next;
}

function initializeLanguagePreference() {
  activeLanguage = readStoredLanguage();
  installLanguageSettings();
  setLanguage(activeLanguage, { persist: false });
  installObserver();
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.body) initializeLanguagePreference();
  else document.addEventListener('DOMContentLoaded', initializeLanguagePreference, { once: true });
}

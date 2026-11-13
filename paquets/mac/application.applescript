-- Living Business, application Mac : applet AppleScript « stay-open », compilée par osacompile à la fabrication du
-- paquet (scripts/paquets.ts). Elle demande à src/lanceur.ts (--application) de rouvrir ou de démarrer le jeu, garde
-- son icône dans le Dock tant que le serveur qu'elle a démarré tourne, et arrête ce serveur, et lui seul, quand on la
-- quitte (le serveur s'arrête aussi de lui-même si l'application disparaît).
--   double-clic : démarre le serveur en arrière-plan (ou retrouve celui qui tourne déjà) et ouvre le navigateur ;
--   clic sur l'icône du Dock, ou nouveau double-clic : rouvre le navigateur ;
--   Quitter (⌘Q, ou le Dock) : arrête le serveur démarré par l'application ;
--   touche ⌥ (Option) enfoncée à l'ouverture : secours du mot de passe (page de réinitialisation, 15 minutes) ;
--   ouverte sans avoir été déplacée (macOS la lance alors depuis …/AppTranslocation/…) : propose de la ranger.
use AppleScript version "2.4"
use framework "Foundation"
use framework "AppKit"
use scripting additions

global serveurPid -- numéro du serveur démarré par cette application ("" : aucun)

on run
	set serveurPid to ""
	set avecOption to toucheOption()
	if (POSIX path of (path to me)) contains "/AppTranslocation/" then
		set choix to button returned of (display dialog "Rangez Living Business dans le dossier Applications : glissez son icône dans le dossier Applications, puis ouvrez-la de là." & return & return & "Sinon, macOS l’ouvre depuis un emplacement provisoire, et le lancement au démarrage de l’ordinateur reste impossible." buttons {"Continuer", "Ouvrir le dossier Applications"} default button 2 with title "Living Business" with icon note)
		if choix is "Ouvrir le dossier Applications" then
			do shell script "open /Applications"
			quit
			return
		end if
	end if
	if avecOption then
		if secoursConfirme() then lancer(true)
	else
		lancer(false)
	end if
	if serveurPid is "" then quit
end run

on reopen
	if toucheOption() then
		if secoursConfirme() then lancer(true)
	else
		lancer(false)
	end if
	if serveurPid is "" then quit
end reopen

on quit
	arreterServeur()
	continue quit
end quit

on toucheOption()
	set drapeaux to (current application's NSEvent's modifierFlags()) as integer
	return (drapeaux div 524288) mod 2 = 1 -- NSEventModifierFlagOption (1 << 19)
end toucheOption

on secoursConfirme()
	try
		display dialog "Mot de passe ET code de secours perdus ?" & return & return & "Living Business ouvre une page pour choisir un nouveau mot de passe. Elle n’est valable que 15 minutes, une seule fois, sur cet ordinateur." buttons {"Annuler", "Ouvrir la page de secours"} default button 2 cancel button 1 with title "Secours mot de passe" with icon note
		return true
	on error number -128
		return false
	end try
end secoursConfirme

-- Réponse de src/lanceur.ts : « pret <pid> <port> » (serveur démarré pour cette application) ou « deja <pid> <port> ».
on lancer(pourSecours)
	set appli to POSIX path of (path to me)
	set moi to (current application's NSProcessInfo's processInfo()'s processIdentifier()) as integer
	set commande to "cd " & quoted form of (appli & "Contents/Resources/app") & " && exec " & quoted form of (appli & "Contents/MacOS/node") & " --disable-warning=ExperimentalWarning src/lanceur.ts --application=" & moi
	if pourSecours then set commande to commande & " --secours"
	try
		set reponse to do shell script commande
	on error message
		display dialog message buttons {"OK"} default button 1 with title "Living Business" with icon caution
		return
	end try
	if word 1 of reponse is "pret" then set serveurPid to word 2 of reponse
end lancer

-- Arrête le serveur démarré par l'application, seulement si ce numéro est toujours celui de son Node.js.
on arreterServeur()
	if serveurPid is "" then return
	set noeud to quoted form of ((POSIX path of (path to me)) & "Contents/MacOS/node")
	try
		do shell script "p=" & serveurPid & "; [ \"$(ps -p $p -o comm= 2>/dev/null)\" = " & noeud & " ] || exit 0; kill -TERM $p; i=0; while kill -0 $p 2>/dev/null && [ $i -lt 100 ]; do sleep 0.1; i=$((i+1)); done; if kill -0 $p 2>/dev/null; then kill -KILL $p; fi; exit 0"
	end try
	set serveurPid to ""
end arreterServeur

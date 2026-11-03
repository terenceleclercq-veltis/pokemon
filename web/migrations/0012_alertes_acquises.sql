-- Alertes de prix (expand, ajouts uniquement) : une carte achetée ou commandée n'a plus rien à surveiller.
-- Signalé par Terence : l'alerte d'une carte devenue la sienne restait active (cloche, annonce au chargement) sans
-- moyen de la retirer. Les déclencheurs couvrent tous les chemins : « Je l'ai », réception d'une commande, import de
-- commandes Cardmarket, restauration d'une sauvegarde.
DELETE FROM alert WHERE card_id IN (SELECT card_id FROM owned WHERE card_id IS NOT NULL);
DELETE FROM alert WHERE card_id IN (SELECT card_id FROM purchase WHERE state <> 'annulee');

CREATE TRIGGER IF NOT EXISTS alert_off_owned_insert AFTER INSERT ON owned
WHEN NEW.card_id IS NOT NULL
BEGIN
  DELETE FROM alert WHERE card_id = NEW.card_id;
END;

CREATE TRIGGER IF NOT EXISTS alert_off_owned_update AFTER UPDATE OF card_id ON owned
WHEN NEW.card_id IS NOT NULL
BEGIN
  DELETE FROM alert WHERE card_id = NEW.card_id;
END;

CREATE TRIGGER IF NOT EXISTS alert_off_purchase AFTER INSERT ON purchase
WHEN NEW.state <> 'annulee'
BEGIN
  DELETE FROM alert WHERE card_id = NEW.card_id;
END;

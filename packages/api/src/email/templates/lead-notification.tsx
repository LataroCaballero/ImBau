// Minimal React Email template for the new-lead notification (D-07, LEADS-04) — es-AR voseo.
//
// Foundation-level, no branded design (the showroom design system lands in a later
// milestone). Clones the invitation.tsx idiom: typed props, no styling system, same
// @react-email/components imports and `<Html lang="es-AR">`. Rendered server-side by
// send-lead-notification.ts when RESEND_API_KEY is present; in dev the summary is logged to
// the console instead (D-09), so this template only matters once real Resend delivery is wired.
//
// All copy is verbatim from UI-SPEC §Notification email template.
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";

export interface LeadNotificationEmailProps {
  // Lead contact name (as captured on the lead).
  nombre: string;
  // Lead contact string (phone / email / WhatsApp — resolved server-side).
  contacto: string;
  // Human-readable origen of the lead (resolved string, e.g. "WhatsApp", "Formulario web").
  origen: string;
  // The project the lead belongs to.
  projectNombre: string;
  // Fully-qualified deep link to the project's bandeja de leads in the panel.
  deepLink: string;
}

// es-AR voseo copy ("Tenés un lead nuevo", "Ver el lead en el panel"). English identifiers,
// Spanish UI.
export function LeadNotificationEmail({
  nombre,
  contacto,
  origen,
  projectNombre,
  deepLink,
}: LeadNotificationEmailProps): React.JSX.Element {
  return (
    <Html lang="es-AR">
      <Head />
      <Preview>{`${nombre} — ${origen}`}</Preview>
      <Body>
        <Container>
          <Heading as="h1">Nuevo lead en {projectNombre}</Heading>
          <Text>Nombre: {nombre}</Text>
          <Text>Contacto: {contacto}</Text>
          <Text>Origen: {origen}</Text>
          <Text>Proyecto: {projectNombre}</Text>
          <Button href={deepLink}>Ver el lead en el panel</Button>
        </Container>
      </Body>
    </Html>
  );
}

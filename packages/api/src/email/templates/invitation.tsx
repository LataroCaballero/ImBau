// Minimal React Email template for the org invitation (D-11/D-13) — es-AR voseo.
//
// Foundation-level, no branded design (the showroom design system lands in a later
// milestone). Mirrors packages/ui's minimal-functional-component idiom: typed props, no
// styling system. Rendered server-side by send-invitation.ts when RESEND_API_KEY is present;
// in dev the link is logged to the console instead (D-09), so this template only matters once
// real Resend delivery is wired in staging.
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

export interface InvitationEmailProps {
  // The fully-qualified /accept-invitation/[id] link the invitee clicks.
  acceptUrl: string;
  // The organization the invitee is being added to.
  orgName: string;
  // The display name of the person who sent the invitation.
  inviter: string;
}

// es-AR voseo copy ("te invitó", "Aceptá la invitación"). English identifiers, Spanish UI.
export function InvitationEmail({
  acceptUrl,
  orgName,
  inviter,
}: InvitationEmailProps): React.JSX.Element {
  return (
    <Html lang="es-AR">
      <Head />
      <Preview>{`${inviter} te invitó a ${orgName} en ImBau`}</Preview>
      <Body>
        <Container>
          <Heading as="h1">Te invitaron a {orgName}</Heading>
          <Text>
            {inviter} te invitó a unirte a la organización {orgName} en ImBau.
          </Text>
          <Text>
            Para entrar, aceptá la invitación desde el siguiente enlace:
          </Text>
          <Button href={acceptUrl}>Aceptar la invitación</Button>
          <Text>
            Si el botón no funciona, copiá y pegá esta dirección en tu
            navegador: {acceptUrl}
          </Text>
          <Text>Si no esperabas esta invitación, podés ignorar este correo.</Text>
        </Container>
      </Body>
    </Html>
  );
}

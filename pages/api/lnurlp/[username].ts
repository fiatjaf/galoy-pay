import crypto from "crypto"
import originalUrl from "original-url"
import { ApolloClient, gql, HttpLink, InMemoryCache } from "@apollo/client"

import { client } from "../../../lib/graphql"
import { GRAPHQL_URI } from "../../../lib/config"

const client = new ApolloClient({
  link: new HttpLink({
    uri: GRAPHQL_URI,
  }),
  cache: new InMemoryCache(),
})

const USER_WALLET_ID = gql`
  query userDefaultWalletId($username: Username!) {
    userDefaultWalletId(username: $username)
  }
`

const LNURL_INVOICE = gql`
  mutation lnInvoiceCreateOnBehalfOfRecipient(
    $walletId: WalletId!
    $amount: SatAmount!
    $h: Hex32Bytes!
  ) {
    mutationData: lnInvoiceCreateOnBehalfOfRecipient(
      input: { recipientWalletId: $walletId, amount: $amount, descriptionHash: $h }
    ) {
      errors {
        message
      }
      invoice {
        paymentRequest
      }
    }
  }
`

export default async function (req, res) {
  const { username, amount } = req.query

  let walletId

  try {
    const { data } = await client.query({
      query: USER_WALLET_ID,
      variables: { username },
    })
    walletId = data.userDefaultWalletId
  } catch (err) {
    return res.status(200).json({
      status: "ERROR",
      reason: `Couldn't find user '${username}'.`,
    })
  }

  const metadata = getUserMetadata(username)

  if (amount) {
    // second call, return invoice
    try {
      const descriptionHash = crypto.createHash("sha256").update(metadata).digest("hex")

      const {
        data: {
          mutationData: { errors, invoice },
        },
      } = await client.mutate({
        mutation: LNURL_INVOICE,
        variables: {
          walletId,
          amount: parseInt(amount, 10),
          h: descriptionHash,
        },
      })

      if (errors && errors.length) {
        console.log("error getting invoice", errors)
        return res.status(200).json({
          status: "ERROR",
          reason: `Failed to get invoice: ${errors[0].message}`,
        })
      }

      res.status(200).json({
        pr: invoice.paymentRequest,
        routes: [],
      })
    } catch (err) {
      console.log("unexpected error getting invoice", err)
      res.status(200).json({
        status: "ERROR",
        reason: err.message,
      })
    }
  } else {
    // first call
    res.status(200).json({
      callback: originalUrl(req).full,
      maxSendable: 1000,
      minSendable: 500000000,
      metadata: metadata,
      tag: "payRequest",
    })
  }
}

function getUserMetadata(username: string) {
  return JSON.stringify([["text/plain", `Payment to ${username}`]])
}

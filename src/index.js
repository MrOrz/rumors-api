import 'dotenv/config';
import Koa from 'koa';
import Router from 'koa-router';
import path from 'path';
import pug from 'pug';
import { printSchema } from 'graphql/utilities';
import { ApolloServer } from 'apollo-server-koa';
import koaStatic from 'koa-static';
import koaBody from 'koa-bodyparser';
import session from 'koa-session2';
import passport from 'koa-passport';
import { formatError } from 'graphql';
import schema from './graphql/schema';
import DataLoaders from './graphql/dataLoaders';

import { AUTH_ERROR_MSG } from './graphql/util';
import CookieStore from './CookieStore';
import rollbar from './rollbarInstance';

import auth from './middlewares/auth';
import { loginRouter, loginCallbackRouter } from './middlewares/passport';

const app = new Koa();
const router = Router();

app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    rollbar.handleError(err, ctx.request);
    throw err;
  }
});

app.use(
  koaBody({
    formLimit: '1mb',
    jsonLimit: '10mb',
    textLimit: '10mb',
  })
);

app.keys = (process.env.COOKIE_SECRETS || '').split(',');

app.use(
  session({
    store: new CookieStore({ password: app.keys[0] }),
    signed: true,
    maxAge: process.env.COOKIE_MAXAGE,
  })
);
app.use(passport.initialize());
app.use(passport.session());

router.use('/login', loginRouter.routes(), loginRouter.allowedMethods());
router.use(
  '/callback',
  loginCallbackRouter.routes(),
  loginCallbackRouter.allowedMethods()
);

router.options('/logout', auth());
router.post('/logout', auth(), ctx => {
  ctx.logout();
  ctx.body = { success: true };
});

router.options('/graphql', auth());
router.post('/graphql', auth());

const indexFn = pug.compileFile(path.join(__dirname, 'jade/index.jade'));
const schemaStr = printSchema(schema);
router.get('/', ctx => {
  ctx.body = indexFn({ schemaStr });
});

app.use(koaStatic(path.join(__dirname, '../static/')));
app.use(router.routes(), router.allowedMethods());

const apolloServer = new ApolloServer({
  schema,
  introspection: true, // Allow introspection in production as well
  playground: true,
  context: ({ ctx }) => ({
    loaders: new DataLoaders(), // new loaders per request
    user: ctx.state.user,

    // userId-appId pair
    //
    userId:
      ctx.appId === 'WEBSITE' || ctx.appId === 'DEVELOPMENT_FRONTEND'
        ? (ctx.state.user || {}).id
        : ctx.query.userId,
    appId: ctx.appId,
  }),
  formatError(err) {
    // make web clients know they should login
    //
    const formattedError = formatError(err);
    formattedError.authError = err.message === AUTH_ERROR_MSG;
    return formattedError;
  },
});

apolloServer.applyMiddleware({
  app,
  cors: false, // checkHeaders already managed CORS, don't mess up with that
});

const port = process.env.PORT || 5000;

app.listen(port, () => {
  console.log('Listening port', port); // eslint-disable-line no-console
});

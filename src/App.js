import React, { Component } from 'react';
import './App.css';
const firebase = window.firebase;
const auth = firebase.auth();
const db = firebase.database();


const data = {
  user: null,
  users: {},
  events: {},
  splitters: {},
  payments: {},
  currencies: {
    SEK: {
      name: 'Swedish kronor',
      factor: 1,
      code: 'SEK'
    },
    JPY: {
      name: 'Japanese Yen',
      factor: 12.6,
      code: 'JPY'
    },
    USD: {
      name: 'US Dollar',
      factor: 0.11,
      code: 'USD'
    }
  },
  primaryCurrency: 'SEK'
}

class Expander extends Component {

  constructor() {
    super();
    this.state = { expanded: false };
  }

  toggleExpand() {
    this.setState({expanded: !this.state.expanded});
  }

  render() {

    let children = null;
    if (this.state.expanded) {
      children = (
        <div className="Expander-content">
          { this.props.children }
        </div>
      );
    }

    return (
      <div className={`Expander ${this.state.expanded ? 'Expander-expanded' : ''}`}>
        <div className="Expander-header" onClick={this.toggleExpand.bind(this)}>
          { this.props.header }
          <span className="Expander-arrow">&rsaquo;</span>
        </div>
        { children }
      </div>
    )
  }
}

class MoneyPresenter extends Component {
  render() {

    let currency = Object.values(data.currencies).find(curr => curr.code === this.props.currency)
    let amount = this.props.amount;

    let otherCurrencies = Object.values(data.currencies).filter(curr => curr.code !== this.props.currency)
    let otherAmounts = otherCurrencies.map(otherCurrency => {
      let otherAmount = Math.ceil((amount/currency.factor)*otherCurrency.factor);
      return `~ ${otherAmount} ${otherCurrency.code}`;
    }).join(', ');

    return (
      <div>
        {Math.ceil(this.props.amount)} {currency.code} ({otherAmounts})
      </div>
    )

  }
}

class App extends Component {

  componentWillMount() {
    auth.onAuthStateChanged((user) => {
      if (user) { data.user = user; } 
      else { data.user = false; }
      this.forceUpdate();

      // Add myself to list of users
      db.ref(`users/${data.user.uid}`).set({
        uid: data.user.uid,
        displayName: data.user.displayName,
        photoURL: data.user.photoURL,
        lastLogin: new Date().toISOString()
      });
    });    

    db.ref(`users/`).on('value', (s) => {
      data.users = s.val();
      this.forceUpdate();
    });

    db.ref(`events/`).on('value', (s) => {
      data.events = s.val() || {};
      this.forceUpdate();
    });

    db.ref(`splitters/`).on('value', (s) => {
      data.splitters = s.val() || {};
      this.forceUpdate();
    });

    db.ref(`payments/`).on('value', (s) => {
      data.payments = s.val() || {};
      this.forceUpdate();
    });
  }

  login(provider) {
    auth.signInWithRedirect(provider);
  }

  logout() {
    auth.signOut();
  }

  createEvent() {
    let event = {
      name: this.refs.eventName.value,
      cost: this.refs.eventCost.value,
      currency: this.refs.eventCurrency.value,
      created: new Date().toISOString()
    }

    console.log({event})

    db.ref('events/').push().set(event)

    this.refs.expanderEventCreate.setState({ expanded: false });
  }

  deleteEvent(id) {
    if (!confirm("Really delete this event?")) return;

    db.ref(`events/${id}`).child('enabled').set(false)
  }

  toggleSplitter(eventId, userId, isSplitter) {
    if (!isSplitter) {
      let splitId = Object.entries(data.splitters).find(([idx, s]) => s.eventId === eventId && s.userId === userId)[0];
      db.ref(`splitters/${splitId}`).remove();
    } else {
      db.ref(`splitters/`).push().set({ eventId, userId, created: new Date().toISOString() });
    }
  }

  addPayment(eventId) {
    if (!this.refs.paymentPaid.value) return;

    db.ref(`payments/`).push().set({
      userId: data.user.uid,
      eventId: eventId,
      paid: this.refs.paymentPaid.value,
      currency: this.refs.paymentCurrency.value,
      created: new Date().toISOString()
    });
  }

  deletePayment(payment) {
    if (!confirm("Really delete this payment?")) return;

    let paymentId = Object.entries(data.payments).find(([paymentId, p]) => p === payment)[0];

    db.ref(`payments/${paymentId}`).remove();
  }

  render() {

    let userElem = null;
    if (data.user) {
      userElem = (
        <div>
          {data.user.displayName}
          <small><a style={{marginLeft:'8px', color: '#999'}} href="" onClick={this.logout.bind(this)}>Logout</a></small>
        </div>
      );
    }

    let loginElem = null;
    if (data.user === false) {
      loginElem = (
        <div className="App-login">
          <h4>Login / Create account using:</h4>
          <small>This app will only access your name, e-mail and profile picture.</small>
          <button onClick={this.login.bind(this, new firebase.auth.GoogleAuthProvider())}>Log in with Google</button>
          <button onClick={this.login.bind(this, new firebase.auth.FacebookAuthProvider())}>Log in with Facebook</button>
        </div>
      );
    }
    if (data.user === null) {
      loginElem = 'Loading..'
    }

    let flowElem = null;
    if (data.user) {

      let flows = [];
      let primaryCurrency = Object.values(data.currencies).find(c => c.code === data.primaryCurrency);

      Object.values(data.users).forEach(fromUser => {
        Object.values(data.users).forEach(toUser => {
          if (fromUser === toUser) return;
          let flow = { fromUser, toUser, amount: 0, currency: primaryCurrency.code };

          Object.entries(data.events).forEach(([eventId, event]) => {
            if (event.enabled === false) return;

            let splitters = Object.values(data.splitters).filter(s => s.eventId === eventId).map(s => s.userId);
            
            // If "fromUser" is not a splitter in this event, then they don't need to pay "toUser" for it.
            if (splitters.indexOf(fromUser.uid) === -1) return;
            
            let eventCurrency = Object.values(data.currencies).find(c => c.code === event.currency);
            let eventCost = (parseInt(event.cost, 10) / eventCurrency.factor) * primaryCurrency.factor;

            let partAmount = eventCost / splitters.length;

            let payments = Object.values(data.payments).filter(p => p.eventId === eventId && p.userId === toUser.uid);
            payments.forEach(payment => {
              let paidCurrency = Object.values(data.currencies).find(c => c.code === payment.currency);
              let paid = (parseInt(payment.paid, 10) / paidCurrency.factor) * primaryCurrency.factor;
              flow.amount += partAmount * (paid / eventCost);
            });
          });

          flows.push(flow);
        });
      });

      flowElem = (
        <div className="Flows">
          <h4>Total cash flows ({flows.length})</h4>
          {
            flows.map(flow => {

              return (
                <div key={flow.fromUser.uid + flow.toUser.uid} className="Flow">
                  <div className="Flow-user">
                    <img alt="Profile" src={flow.fromUser.photoURL} style={{height: '30px'}} />
                    {flow.fromUser.displayName}
                  </div>

                  --&gt;

                  <div className="Flow-user">
                    <img alt="Profile" src={flow.toUser.photoURL} style={{height: '30px'}} />
                    {flow.toUser.displayName}
                  </div>

                  <MoneyPresenter amount={flow.amount} currency={flow.currency} />
                </div>
              )
            })
          }
        </div>
      )
    }

    let eventsElem = null;
    if (data.user) {
      eventsElem = (
        <div className="Events">
          <h4>Events ({Object.values(data.events).length})</h4>

          {
            Object.keys(data.events).map(eventId => {
              let event = data.events[eventId];
              if (event.enabled === false) return null;

              let payments = Object.values(data.payments).filter(p => p.eventId === eventId);

              return (
                <Expander key={eventId} header={`${event.name} [${new Date(event.created).toLocaleString()}]`}>
                  <div className="Event">
                    <label>Total cost:</label>
                    <MoneyPresenter amount={event.cost} currency={event.currency} />
                    <br/>
                    <label>Total paid:</label>
                    {
                      (() => {
                        let primaryCurrency = Object.values(data.currencies).find(c => c.code === data.primaryCurrency);
                        let amount = payments.reduce((memo, p) => {

                          let paidCurrency = Object.values(data.currencies).find(c => c.code === p.currency);
                          let m = (parseInt(p.paid, 10) / paidCurrency.factor) * primaryCurrency.factor;

                          return memo + m;
                        }, 0)

                        amount = Math.ceil(amount);
                        return <MoneyPresenter amount={amount} currency={primaryCurrency.code} />
                      })()
                    }
                    <br/>
                    <label>Payments ({payments.length}):</label>
                    {
                      payments.map((payment,idx) => {
                        let user = Object.values(data.users).find(u => u.uid === payment.userId);

                        return (
                          <div key={user.uid+'-'+idx} className="Payment">
                            {user.displayName}: <MoneyPresenter amount={payment.paid} currency={payment.currency} />
                            <button onClick={this.deletePayment.bind(this, payment)}>x</button>
                          </div>
                        )
                      })
                    }

                    <br/>
                    <label>Split by:</label>
                    <div>
                      {
                        Object.values(data.users).map(user => {

                          let split = Object.values(data.splitters).find(s => s.eventId === eventId && s.userId === user.uid);
                          let isSplitter = !!split;

                          return (
                            <div key={user.uid} className="Splitter" onClick={this.toggleSplitter.bind(this, eventId, user.uid, !isSplitter)} title={split ? `Made a splitter at: ${new Date(split.created).toLocaleString()}` : ''}>
                              <img alt="Profile" src={user.photoURL} style={{height: '30px'}} />
                              {user.displayName}
                              <input type="checkbox" checked={isSplitter} disabled={true} />
                            </div>
                          )
                        })
                      }
                    </div>

                    <br/>

                    <div>
                      <h6>I have paid:</h6>
                      <input type="number" ref="paymentPaid" placeholder="Ex: 120" />
                      <select ref="paymentCurrency">
                        {
                          Object
                          .entries(data.currencies)
                          .map(([code,c]) => <option key={code} value={code}>{c.name} ({code})</option>)
                        }
                      </select>
                      <button onClick={this.addPayment.bind(this, eventId)}>Add my payment</button>
                    </div>

                    <br/>

                    <button style={{alignSelf: 'flex-end'}} onClick={this.deleteEvent.bind(this, eventId)}>Delete event</button>
                  </div>
                </Expander>
              )
            })
          }
          
          <Expander ref="expanderEventCreate" header={<em>Create event</em>}>
            <div className="Event Event-create">
              <label>Name of event</label>
              <input type="text" ref="eventName" placeholder="Ex: Breakfast at Bishops" />
              <br/>
              <label>Total cost (optional)</label>
              <input type="text" ref="eventCost" placeholder="Ex: 389" />
              <br/>
              <label>Currency</label>
              <select ref="eventCurrency">
                <option value="SEK">Swedish kronor (SEK)</option>
                <option value="JPY">Japanese Yen (JPY)</option>
              </select>
              
              <br/>
              <button onClick={this.createEvent.bind(this)}>Create</button>
            </div>
          </Expander>

        </div>
      )
    }

    let usersElem = null;
    if (data.user) {
      usersElem = (
        <div className="Users">
          <h4>Users ({Object.values(data.users).length})</h4>

          {
            Object.keys(data.users).map(userId => {
              let user = data.users[userId];
              if (user.enabled === false) return null;

              return (
                <div key={user.uid} className="User">
                  <img alt="User profile" src={user.photoURL} />
                  <div style={{display:'flex',flexDirection:'column',textAlign:'left'}}>
                    { user.displayName }<br/>
                    <small>Last login: { new Date(user.lastLogin).toLocaleString() }</small>
                  </div>
                </div>
              )
            })
          }
        </div>
      )
    }

    let currenciesElem = (
      <div className="Currencies">
        <h4>Currencies ({Object.values(data.currencies).length})</h4>
        {
          Object.values(data.currencies).map(currency => {
            let elems = [];
            elems.push(<label key={currency.code}>1 {currency.name} ({currency.code})</label>);
            Object.values(data.currencies).filter(c => c.code !== currency.code).forEach(otherCurrency => {
              elems.push(<p key={otherCurrency.code}>= {((currency.factor / otherCurrency.factor).toFixed(2))} {otherCurrency.name} ({otherCurrency.code})</p>);
            });

            return <div key={currency.code} className="Currency">{elems}</div>;
          })
        }
      </div>
    );

    return (
      <div className="App">
        <div className="App-header">
          <h2>Cash Flow</h2>
          <div className="App-userbar">
            { userElem }
          </div>
        </div>
        <div className="Container">
          { loginElem }
          { eventsElem }
          { usersElem }
          { flowElem }
          { currenciesElem }
        </div>

        
        <div className="Container">
          <pre style={{textAlign: 'left', fontSize: '9pt', whiteSpace: 'pre-wrap', wordWrap: 'break-word'}}>
            Debug info: <br/>
            { JSON.stringify(data, null, 2)}
          </pre>
        </div>

        <footer>
          <small>Cash Flow - Johan Deckmar - 2017</small>
        </footer>
      </div>
    );
  }
}

export default App;

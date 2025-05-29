package com.vm.identityprovider.service;

import com.vm.identityprovider.dto.UserPrincipal;
import com.vm.identityprovider.entity.Users;
import com.vm.identityprovider.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class UserService implements UserDetailsService {

    @Autowired
    private UserRepository userRepository;

//    @Autowired
//    private AuthenticationManager authManager;

    private BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(5);

    @Override
    public UserDetails loadUserByUsername(final String username) throws UsernameNotFoundException {

        final Users user = userRepository.findByUsername(username);
        if (user == null) {
            throw new UsernameNotFoundException("User not found");
        }
        return new UserPrincipal(user);
    }

    public Users register(Users user){
        user.setPassword(encoder.encode(user.getPassword()));
        return userRepository.save(user);
    }


//    public String verify(Users user) {
//        Authentication authentication =
//                authManager.authenticate(new UsernamePasswordAuthenticationToken(user.getUsername(), user.getPassword()));
//
//        if (authentication.isAuthenticated()){
//            return "success";
//        }
//        return "failed";
//    }
}
